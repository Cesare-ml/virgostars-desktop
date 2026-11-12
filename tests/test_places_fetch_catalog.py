"""Synthetic tests for verified installation; no licensed data is used."""
import hashlib
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
        self.meta = {"schemaVersion": 2, "rowCount": 3, "countryLookupCount": 244,
                     "bytes": len(self.db), "sha256": self.db_hash}

    def pack(self, extra=False):
        with zipfile.ZipFile(self.archive, "w") as z:
            z.writestr("world-cities.sqlite", self.db)
            z.writestr("world-cities.manifest.json", json.dumps(self.meta))
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
