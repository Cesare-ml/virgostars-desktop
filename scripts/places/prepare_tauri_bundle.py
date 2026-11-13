#!/usr/bin/env python3
"""Generate an ignored Tauri 2 configuration override for a locally built city pack.

The default Tauri prototype continues to work without the private catalog.
This helper checks the catalog/manifest and never changes tracked Tauri config.
"""
import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile

EXPECTED_ROWS = 1_951_599


def sha256_of(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def prepare(root: Path, expected: int = EXPECTED_ROWS) -> Path:
    root = root.resolve()
    local_dir = root / ".local"
    places_dir = local_dir / "places"
    catalog = places_dir / "world-cities.sqlite"
    manifest_file = places_dir / "world-cities.manifest.json"
    # Never package linked resources from outside the owner's local pack area.
    if local_dir.is_symlink() or places_dir.is_symlink() or catalog.is_symlink() or manifest_file.is_symlink():
        raise ValueError("City pack paths must not be symbolic links")
    if not catalog.is_file() or not manifest_file.is_file():
        raise FileNotFoundError("Missing catalog or manifest: build the local SQLite pack first")
    info = json.loads(manifest_file.read_text(encoding="utf-8"))
    if (info.get("schemaVersion") not in (1, 2) or
        info.get("rowCount") != expected or
        info.get("file") != catalog.name or
        info.get("bytes") != catalog.stat().st_size or
        info.get("sha256") != sha256_of(catalog)):
        raise ValueError("City pack metadata, size, count or checksum mismatch")
    with closing(sqlite3.connect(catalog.as_uri() + "?mode=ro", uri=True)) as connection:
        count = connection.execute("SELECT value FROM catalog_meta WHERE key='rowCount'").fetchone()
        if count is None or count[0] != str(expected):
            raise ValueError("Database row count metadata does not match manifest")
        version = connection.execute("SELECT value FROM catalog_meta WHERE key='schemaVersion'").fetchone()
        if version is None or version[0] != str(info["schemaVersion"]):
            raise ValueError("Pack schema version does not match database")
        if info["schemaVersion"] == 2:
            has_table = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='country_lookup'"
            ).fetchone()
            mapped_count = connection.execute("SELECT count(*) FROM country_lookup").fetchone()[0] if has_table else -1
            if mapped_count != info.get("countryLookupCount") or mapped_count < 1:
                raise ValueError("Country lookup table or count does not match manifest")

    # Resource inputs are resolved relative to src-tauri/ by Tauri 2.
    override = {
        "bundle": {
            "active": True,
            "resources": {
                "../.local/places/world-cities.sqlite": "places/world-cities.sqlite",
                "../.local/places/world-cities.manifest.json": "places/world-cities.manifest.json",
            },
        },
    }
    out = places_dir / "tauri-places.conf.json"
    if out.is_symlink():
        raise ValueError("Refusing a symbolic-link Tauri city override")
    # A crash must not truncate the last valid override. Keep the temp file in
    # the same directory for a same-filesystem replacement; clean up on error.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="\n", prefix=".tauri-places-",
            suffix=".tmp", dir=places_dir, delete=False
        ) as stream:
            temporary = Path(stream.name)
            stream.write(json.dumps(override, indent=2) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, out)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--expected-rows", type=int, default=EXPECTED_ROWS)
    args = parser.parse_args()
    file = prepare(args.root, args.expected_rows)
    print("Tauri city-pack override generated: " + str(file))
    print("This does not automatically build/sign a Windows installer.")


if __name__ == "__main__":
    main()
