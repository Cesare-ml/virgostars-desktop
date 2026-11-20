#!/usr/bin/env python3
"""Fetch the pinned private GitHub release asset; verify before installing locally."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

REPOSITORY = "Cesare-ml/virgostars-desktop"
TAG = "places-20261112-v2"
ARCHIVE = "world-cities.zip"
ARCHIVE_SHA256 = "b27c5d268deca8a20c58e1ff3c9a3d275b11ab38471d8a78915965649b8a2b64"
DATABASE_SHA256 = "605f0d0e3646812b3aaa4acd8b895dd462b10b58d986df1c2e4ca1a486c7457a"
DATABASE_SIZE = 196808704
ROW_COUNT = 1951599


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as src:
        for block in iter(lambda: src.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def install_archive(archive: Path, destination: Path, archive_hash: str = ARCHIVE_SHA256,
                    database_hash: str = DATABASE_SHA256, database_size: int = DATABASE_SIZE,
                    rows: int = ROW_COUNT) -> None:
    if digest(archive) != archive_hash:
        raise ValueError("Catalog archive checksum mismatch")
    destination.mkdir(parents=True, exist_ok=True)
    database = destination / "world-cities.sqlite"
    manifest = destination / "world-cities.manifest.json"
    if database.exists() or manifest.exists():
        if database.is_file() and manifest.is_file():
            metadata = json.loads(manifest.read_text(encoding="utf-8"))
            if (database.stat().st_size == database_size and digest(database) == database_hash
                    and metadata.get("sha256") == database_hash and metadata.get("rowCount") == rows
                    and metadata.get("bytes") == database_size and metadata.get("schemaVersion") == 2
                    and metadata.get("countryLookupCount") == 244):
                return
        raise FileExistsError("Existing catalog differs or is incomplete; preserve it and inspect manually")
    with tempfile.TemporaryDirectory(prefix=".catalog-", dir=destination) as tmp:
        tmpdir = Path(tmp)
        with zipfile.ZipFile(archive) as pack:
            if sorted(pack.namelist()) != ["world-cities.manifest.json", "world-cities.sqlite"]:
                raise ValueError("Unexpected archive entries")
            if pack.getinfo("world-cities.sqlite").file_size != database_size or pack.getinfo("world-cities.manifest.json").file_size > 16384:
                raise ValueError("Unexpected catalog size")
            for name in ("world-cities.sqlite", "world-cities.manifest.json"):
                with pack.open(name) as src, (tmpdir / name).open("xb") as dst:
                    shutil.copyfileobj(src, dst)
        staged = tmpdir / database.name
        meta = json.loads((tmpdir / manifest.name).read_text(encoding="utf-8"))
        if (digest(staged) != database_hash or meta.get("sha256") != database_hash or
                meta.get("bytes") != database_size or meta.get("rowCount") != rows or
                meta.get("schemaVersion") != 2 or meta.get("countryLookupCount") != 244):
            raise ValueError("Catalog metadata or checksum mismatch")
        # Refuse overwrites even if another process created a destination meanwhile.
        created_database = False
        created_manifest = False
        try:
            with database.open("xb") as dst:
                created_database = True
                with staged.open("rb") as src:
                    shutil.copyfileobj(src, dst)
            with manifest.open("xb") as dst:
                created_manifest = True
                with (tmpdir / manifest.name).open("rb") as src:
                    shutil.copyfileobj(src, dst)
        except Exception:
            if created_database:
                database.unlink()
            if created_manifest:
                manifest.unlink()
            raise


def main() -> None:
    root = Path(__file__).absolute().parents[2]
    dest = root / ".local" / "places"
    parser = argparse.ArgumentParser(description="Install the pinned VirgoStars city catalog")
    parser.add_argument("--archive", type=Path, help="Use a locally downloaded archive instead of GitHub CLI")
    args = parser.parse_args()
    if args.archive is not None:
        install_archive(args.archive, dest)
        print("Verified offline city catalog installed in .local/places.")
        return
    gh = shutil.which("gh")
    if not gh:
        raise SystemExit("GitHub CLI (gh) is required; install it and run gh auth login with repository access.")
    with tempfile.TemporaryDirectory(prefix="virgostars-download-") as tmp:
        subprocess.run([gh, "release", "download", TAG, "--repo", REPOSITORY,
                        "--pattern", ARCHIVE, "--dir", tmp], check=True)
        install_archive(Path(tmp) / ARCHIVE, dest)
    print("Verified offline city catalog installed in .local/places.")


if __name__ == "__main__":
    main()
