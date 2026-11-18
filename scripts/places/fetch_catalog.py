#!/usr/bin/env python3
"""Fetch the pinned private GitHub release asset; verify before installing locally."""
from __future__ import annotations

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
MAX_MANIFEST_BYTES = 16_384


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as src:
        for block in iter(lambda: src.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def checked_manifest(path: Path, database_hash: str, database_size: int, rows: int) -> dict:
    """Validate bounded, unambiguous UTF-8 metadata before accepting a catalog."""
    with path.open("rb") as source:
        raw = source.read(MAX_MANIFEST_BYTES + 1)
    if not raw or len(raw) > MAX_MANIFEST_BYTES:
        raise ValueError("Invalid catalog manifest size")

    def unique_keys(pairs):
        values = {}
        for key, value in pairs:
            if key in values:
                raise ValueError("Duplicate catalog manifest key")
            values[key] = value
        return values

    try:
        info = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_keys)
    except (UnicodeDecodeError, ValueError) as error:
        raise ValueError("Invalid catalog manifest JSON") from error
    # Python booleans compare equal to integers; require exact JSON integer types.
    if (not isinstance(info, dict) or info.get("file") != "world-cities.sqlite" or
            type(info.get("schemaVersion")) is not int or info["schemaVersion"] != 2 or
            type(info.get("rowCount")) is not int or info["rowCount"] != rows or
            type(info.get("countryLookupCount")) is not int or info["countryLookupCount"] != 244 or
            type(info.get("bytes")) is not int or info["bytes"] != database_size or
            info.get("sha256") != database_hash):
        raise ValueError("Catalog manifest metadata mismatch")
    return info


def install_archive(archive: Path, destination: Path, archive_hash: str = ARCHIVE_SHA256,
                    database_hash: str = DATABASE_SHA256, database_size: int = DATABASE_SIZE,
                    rows: int = ROW_COUNT) -> None:
    if digest(archive) != archive_hash:
        raise ValueError("Catalog archive checksum mismatch")
    # A fixed .local/places destination must never be redirected by a
    # pre-existing symlink (including the immediately enclosing .local dir).
    if destination.is_symlink() or destination.parent.is_symlink():
        raise ValueError("Catalog destination must not be a symbolic link")
    destination.mkdir(parents=True, exist_ok=True)
    database = destination / "world-cities.sqlite"
    manifest = destination / "world-cities.manifest.json"
    # is_symlink also catches dangling links, unlike exists()/is_file().
    if database.is_symlink() or manifest.is_symlink():
        raise ValueError("Catalog files must not be symbolic links")
    if database.exists() or manifest.exists():
        if database.is_file() and manifest.is_file():
            checked_manifest(manifest, database_hash, database_size, rows)
            if database.stat().st_size == database_size and digest(database) == database_hash:
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
        checked_manifest(tmpdir / manifest.name, database_hash, database_size, rows)
        if digest(staged) != database_hash:
            raise ValueError("Catalog database checksum mismatch")
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
