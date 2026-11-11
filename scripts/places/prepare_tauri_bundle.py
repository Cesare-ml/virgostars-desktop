#!/usr/bin/env python3
"""Generate an ignored Tauri 2 configuration override for a locally built city pack.

The default Tauri prototype continues to work without the private catalog.
This helper checks the catalog/manifest and never changes tracked Tauri config.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3

EXPECTED_ROWS = 1_951_599


def sha256_of(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def prepare(root: Path, expected: int = EXPECTED_ROWS) -> Path:
    root = root.resolve()
    catalog = root / ".local" / "places" / "world-cities.sqlite"
    manifest_file = root / ".local" / "places" / "world-cities.manifest.json"
    if not catalog.is_file() or not manifest_file.is_file():
        raise FileNotFoundError("Missing catalog or manifest: build the local SQLite pack first")
    info = json.loads(manifest_file.read_text(encoding="utf-8"))
    if (info.get("schemaVersion") != 1 or
        info.get("rowCount") != expected or
        info.get("file") != catalog.name or
        info.get("bytes") != catalog.stat().st_size or
        info.get("sha256") != sha256_of(catalog)):
        raise ValueError("City pack metadata, size, count or checksum mismatch")
    with sqlite3.connect(catalog.as_uri() + "?mode=ro", uri=True) as connection:
        count = connection.execute("SELECT value FROM catalog_meta WHERE key='rowCount'").fetchone()
        if count is None or count[0] != str(expected):
            raise ValueError("Database row count metadata does not match manifest")
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
    out = root / ".local" / "places" / "tauri-places.conf.json"
    out.write_text(json.dumps(override, indent=2) + "\n", encoding="utf-8")
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
