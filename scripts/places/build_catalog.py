#!/usr/bin/env python3
"""Stream a *private* UTF-8 PostgreSQL city CSV into a local offline SQLite/FTS5 pack.

No PostgreSQL access, Internet traffic, third-party Python packages or purchased
records embedded in the repository. The input CSV is expected to be exported
manually from an authorized read-only PostgreSQL query.
"""
from __future__ import annotations

import argparse
import csv
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import zipfile

FIELDS = ("id", "nome", "nome_it", "lat", "lng", "pop", "stato_id", "regione", "tz", "tz_offs")
SCHEMA_VERSION = 1
DEFAULT_COUNT = 1_951_599


def nullable(value: str | None) -> str | None:
    value = (value or "").strip()
    return value if value and value.lower() != "null" else None


def microdegrees(value: str | None, bound: int) -> int:
    if nullable(value) is None:
        raise ValueError("Missing coordinate")
    try:
        coordinate = Decimal(value)
        scaled = coordinate * Decimal(1_000_000)
    except InvalidOperation as error:
        raise ValueError("Invalid coordinate") from error
    if not coordinate.is_finite() or abs(coordinate) > bound or scaled != scaled.to_integral_value():
        raise ValueError("Coordinate outside range or beyond six decimal places")
    return int(scaled)


def optional_int(value: str | None) -> int | None:
    value = nullable(value)
    if value is None:
        return None
    number = int(value)
    if not (0 <= number <= 9_223_372_036_854_775_807):
        raise ValueError("Negative or oversized integer")
    return number


def convert_row(row: dict[str, str | None]) -> tuple:
    identifier = int(row["id"] or "0")
    if not 0 < identifier <= 9_223_372_036_854_775_807:
        raise ValueError("Invalid place ID")
    name = nullable(row["nome"])
    if not name:
        raise ValueError("Place without name")
    return (
        identifier, name, nullable(row["nome_it"]),
        microdegrees(row["lat"], 90), microdegrees(row["lng"], 180),
        optional_int(row["pop"]), optional_int(row["stato_id"]),
        nullable(row["regione"]), nullable(row["tz"]), nullable(row["tz_offs"]),
    )


def create_schema(db: sqlite3.Connection) -> None:
    db.executescript("""
        CREATE TABLE places (
          id INTEGER PRIMARY KEY,
          nome TEXT NOT NULL,
          nome_it TEXT,
          lat_micro INTEGER NOT NULL,
          lng_micro INTEGER NOT NULL,
          pop INTEGER,
          stato_id INTEGER,
          regione TEXT,
          tz TEXT,
          tz_offs TEXT
        );
        CREATE TABLE catalog_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) WITHOUT ROWID;
    """)


def sha256_of(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(data)
    return digest.hexdigest()


def build_catalog(csv_path: Path, dest: Path, expected_rows: int = DEFAULT_COUNT, make_zip: bool = False) -> dict:
    csv_path, dest = csv_path.resolve(), dest.resolve()
    if expected_rows < 1 or csv_path == dest:
        raise ValueError("Invalid input/output or expected row count")
    if not csv_path.is_file():
        raise FileNotFoundError("Input CSV not found")
    dest.parent.mkdir(parents=True, exist_ok=True)
    manifest_path = dest.with_suffix(".manifest.json")
    zip_path = dest.with_suffix(".zip")
    if dest.exists() or manifest_path.exists() or (make_zip and zip_path.exists()):
        raise FileExistsError("Output already exists; choose a new destination to preserve previous data")

    fd, temp_name = tempfile.mkstemp(prefix=".cities-staging-", suffix=".sqlite", dir=dest.parent)
    os.close(fd)
    temp = Path(temp_name)
    temp_manifest = dest.parent / (temp.name + ".manifest.json")
    temp_zip = dest.parent / (temp.name + ".zip")
    db: sqlite3.Connection | None = None
    try:
        db = sqlite3.connect(temp)
        db.execute("PRAGMA journal_mode=OFF")
        db.execute("PRAGMA synchronous=OFF")
        db.execute("PRAGMA temp_store=FILE")
        db.execute("PRAGMA cache_size=-16384")
        create_schema(db)
        n = 0
        with csv_path.open("r", encoding="utf-8-sig", newline="") as source:
            reader = csv.DictReader(source)
            if not reader.fieldnames or any(field not in reader.fieldnames for field in FIELDS):
                raise ValueError("CSV must contain the exact 10 required column names")
            batch = []
            for row in reader:
                try:
                    batch.append(convert_row(row))
                except (ValueError, TypeError, KeyError, InvalidOperation) as error:
                    raise ValueError(f"Invalid city record on CSV line {reader.line_num}") from error
                if len(batch) >= 5000:
                    db.executemany("INSERT INTO places VALUES (?,?,?,?,?,?,?,?,?,?)", batch)
                    n += len(batch)
                    batch.clear()
                    if n % 100000 == 0:
                        print(f"Imported {n:,} rows...", flush=True)
            if batch:
                db.executemany("INSERT INTO places VALUES (?,?,?,?,?,?,?,?,?,?)", batch)
                n += len(batch)
        if n != expected_rows:
            raise ValueError(f"Row count mismatch: {n} != expected {expected_rows}")
        # External-content FTS5 reuses names in places instead of storing a second
        # complete copy of name strings in the search virtual table.
        db.executescript("""
          CREATE VIRTUAL TABLE places_fts USING fts5(
            nome, nome_it, content='places', content_rowid='id',
            tokenize='unicode61 remove_diacritics 2', prefix='2 3'
          );
          INSERT INTO places_fts(places_fts) VALUES ('rebuild');
        """)
        db.executemany("INSERT INTO catalog_meta(key,value) VALUES (?,?)",
                       (("schemaVersion", str(SCHEMA_VERSION)), ("rowCount", str(n))))
        db.commit()
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("SQLite integrity check failed")
        db.close()
        db = None
        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "rowCount": n,
            "file": dest.name,
            "bytes": temp.stat().st_size,
            "sha256": sha256_of(temp),
            "source": "owner-purchased-city-export",
            "notice": "Redistribution and source attribution must be reviewed before public release",
        }
        temp_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                                 encoding="utf-8")
        if make_zip:
            with zipfile.ZipFile(temp_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                archive.write(temp, arcname=dest.name)
                archive.write(temp_manifest, arcname=manifest_path.name)
        os.replace(temp, dest)
        os.replace(temp_manifest, manifest_path)
        if make_zip:
            os.replace(temp_zip, zip_path)
        return manifest
    finally:
        if db is not None:
            db.close()
        for path in (temp, temp_manifest, temp_zip):
            if path.exists():
                path.unlink()


def search_catalog(database: Path, text: str, limit: int = 20) -> list[dict]:
    # Quotes are generated by us from Unicode letter/number tokens, not raw
    # SQL/FTS expressions supplied by the caller.
    words = re.findall(r"\w+", text, re.UNICODE)
    if not words or not (1 <= limit <= 100):
        return []
    query = " ".join('"' + word.replace('"', '""') + '"*' for word in words[:5])
    connection = sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute("""
            WITH candidate AS (
              SELECT rowid FROM places_fts WHERE places_fts MATCH ? LIMIT 500
            )
            SELECT p.id, p.nome, p.nome_it, p.lat_micro, p.lng_micro,
                   p.pop, p.stato_id, p.regione, p.tz
            FROM candidate AS c JOIN places AS p ON p.id = c.rowid
            ORDER BY COALESCE(p.pop,0) DESC, p.nome COLLATE NOCASE, p.id
            LIMIT ?
        """, (query, limit)).fetchall()
        return [dict(row) for row in rows]
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Private offline SQLite city catalog builder")
    commands = parser.add_subparsers(dest="operation", required=True)
    build = commands.add_parser("build")
    build.add_argument("--csv", type=Path, required=True, help="Private UTF-8 CSV from PostgreSQL")
    build.add_argument("--out", type=Path, required=True, help="Ignored .local/places/world-cities.sqlite")
    build.add_argument("--expected-rows", type=int, default=DEFAULT_COUNT)
    build.add_argument("--zip", action="store_true", help="Produce ZIP for manually reviewed Release asset")
    search = commands.add_parser("search")
    search.add_argument("--db", type=Path, required=True)
    search.add_argument("--query", required=True)
    search.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()
    if args.operation == "build":
        result = build_catalog(args.csv, args.out, args.expected_rows, args.zip)
        print(json.dumps(result, indent=2))
    else:
        print(json.dumps(search_catalog(args.db, args.query, args.limit), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
