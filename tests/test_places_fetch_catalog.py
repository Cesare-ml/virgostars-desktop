"""Synthetic tests for verified installation; no licensed data is used."""
import hashlib
import os
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "places"))
from fetch_catalog import install_archive


class FetchCatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / "pack.zip"
        self.output = self.root / "out"
        self.db = b"synthetic catalog"
        self.db_hash = hashlib.sha256(self.db).hexdigest()
        self.meta = {"file": "world-cities.sqlite", "schemaVersion": 2, "rowCount": 3, "countryLookupCount": 244,
                     "bytes": len(self.db), "sha256": self.db_hash}

    def pack(self, extra=False, raw_manifest=None):
        with zipfile.ZipFile(self.archive, "w") as z:
            z.writestr("world-cities.sqlite", self.db)
            z.writestr("world-cities.manifest.json",
                       json.dumps(self.meta) if raw_manifest is None else raw_manifest)
            if extra:
                z.writestr("../escape", "bad")
        return hashlib.sha256(self.archive.read_bytes()).hexdigest()

    def install(self, archive_hash):
        install_archive(self.archive, self.output, archive_hash, self.db_hash, len(self.db), 3)

    def test_install_and_reuse(self):
        archive_hash = self.pack()
        self.install(archive_hash)
        self.install(archive_hash)
        self.assertEqual((self.output / "world-cities.sqlite").read_bytes(), self.db)

    def test_rejects_tampering_and_unexpected_entries(self):
        self.pack()
        with self.assertRaises(ValueError):
            self.install("0" * 64)
        with self.assertRaises(ValueError):
            self.install(self.pack(extra=True))
        self.assertFalse((self.output / "world-cities.sqlite").exists())

    def test_preserves_existing_different_catalog(self):
        archive_hash = self.pack()
        self.output.mkdir()
        target = self.output / "world-cities.sqlite"
        target.write_bytes(b"keep me")
        with self.assertRaises(FileExistsError):
            self.install(archive_hash)
        self.assertEqual(target.read_bytes(), b"keep me")

    def test_manifest_rejects_missing_file_wrong_values_and_bool_numbers(self):
        for changes in (
            {"file": "other.sqlite"},
            {"file": None},
            {"schemaVersion": True},
            {"rowCount": True},
            {"countryLookupCount": False},
            {"bytes": "synthetic"},
        ):
            with self.subTest(changes=changes):
                metadata = dict(self.meta, **changes)
                raw = json.dumps(metadata)
                with self.assertRaises(ValueError):
                    self.install(self.pack(raw_manifest=raw))
                self.assertFalse((self.output / "world-cities.sqlite").exists())

    def test_manifest_rejects_duplicate_keys_and_invalid_utf8(self):
        raw = json.dumps(self.meta)
        duplicate = raw[:-1] + ', "rowCount": 3}'
        for source in (duplicate, b'{"schemaVersion": "\xff"}',
                       b" " * 16_385, b""):
            with self.subTest(source=repr(source)[:80]):
                with self.assertRaises(ValueError):
                    self.install(self.pack(raw_manifest=source))
                self.assertFalse((self.output / "world-cities.sqlite").exists())

    def test_existing_catalog_reuse_checks_manifest_strictly(self):
        archive_hash = self.pack()
        self.install(archive_hash)
        original = (self.output / "world-cities.manifest.json").read_bytes()
        bad = original[:-1] + b', "rowCount": 3}'
        (self.output / "world-cities.manifest.json").write_bytes(bad)
        with self.assertRaises(ValueError):
            self.install(archive_hash)
        self.assertEqual((self.output / "world-cities.sqlite").read_bytes(), self.db)

    def test_symlinked_destination_and_catalog_files_are_never_followed(self):
        archive_hash = self.pack()
        outside = self.root / "outside"
        outside.mkdir()
        destination = self.root / "linked"
        try:
            destination.symlink_to(outside, target_is_directory=True)
        except (OSError, NotImplementedError) as error:
            self.skipTest("Symlink creation is unavailable on this platform: " + type(error).__name__)
        with self.assertRaises(ValueError):
            install_archive(self.archive, destination, archive_hash, self.db_hash, len(self.db), 3)
        self.assertEqual(list(outside.iterdir()), [])
        self.output.mkdir()
        (self.output / "world-cities.sqlite").symlink_to(self.root / "missing", target_is_directory=False)
        with self.assertRaises(ValueError):
            self.install(archive_hash)
        self.assertFalse((self.output / "world-cities.manifest.json").exists())

    def test_symlinked_parent_of_catalog_destination_is_rejected(self):
        archive_hash = self.pack()
        target = self.root / "actual"
        target.mkdir()
        parent = self.root / "linked-local"
        try:
            parent.symlink_to(target, target_is_directory=True)
        except (OSError, NotImplementedError) as error:
            self.skipTest("Symlink creation is unavailable on this platform: " + type(error).__name__)
        with self.assertRaises(ValueError):
            install_archive(self.archive, parent / "places", archive_hash, self.db_hash, len(self.db), 3)
        self.assertEqual(list(target.iterdir()), [])
