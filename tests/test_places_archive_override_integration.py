"""Synthetic cross-language city-pack import -> Tauri resource override smoke.

No production accounts, downloaded catalogs, private cities, or release assets.
Run manually with: python -m unittest discover -s tests -p test_places_archive_override_integration.py -v
"""
from __future__ import annotations

import hashlib
from contextlib import closing
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "places"))
from fetch_catalog import install_archive  # noqa: E402
from prepare_tauri_bundle import prepare  # noqa: E402

NODE_VERIFIER = """
import { verifyPlacesTauriOverride } from './scripts/verify-places-tauri-override.mjs';
try {
  const result = verifyPlacesTauriOverride(process.argv[1]);
  if (result.approvedResources !== 2) process.exitCode = 3;
} catch {
  process.exitCode = 2;
}
"""


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class PlacesArchiveOverrideIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="vs-places-pipeline-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.zip_file = self.root / "fictional-cities.zip"
        self.dest = self.root / ".local" / "places"
        self.database_bytes = self.make_fictional_database()
        self.db_hash = sha256_bytes(self.database_bytes)
        self.manifest = {
            "file": "world-cities.sqlite", "schemaVersion": 2, "rowCount": 3,
            "countryLookupCount": 244, "bytes": len(self.database_bytes),
            "sha256": self.db_hash,
        }
        with zipfile.ZipFile(self.zip_file, "w", compression=zipfile.ZIP_DEFLATED) as pack:
            pack.writestr("world-cities.sqlite", self.database_bytes)
            pack.writestr("world-cities.manifest.json", json.dumps(self.manifest))
        self.zip_hash = sha256_bytes(self.zip_file.read_bytes())

    def make_fictional_database(self) -> bytes:
        file = self.root / "fictional.sqlite"
        # An explicit close is required before unlinking temporary SQLite files
        # on Windows; sqlite3's transaction context alone does not close.
        with closing(sqlite3.connect(file)) as database:
            with database:
                database.execute("CREATE TABLE catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
                database.executemany(
                    "INSERT INTO catalog_meta (key, value) VALUES (?, ?)",
                    [("rowCount", "3"), ("schemaVersion", "2")],
                )
                database.execute("CREATE TABLE country_lookup (code TEXT PRIMARY KEY)")
                database.executemany(
                    "INSERT INTO country_lookup (code) VALUES (?)",
                    [(f"FICT{i:03d}",) for i in range(244)],
                )
        return file.read_bytes()

    def install(self) -> None:
        install_archive(self.zip_file, self.dest, self.zip_hash,
                        self.db_hash, len(self.database_bytes), 3)

    def node_check(self, file: Path) -> subprocess.CompletedProcess[str]:
        node = shutil.which("node")
        if not node:
            self.skipTest("Node.js unavailable; cross-language verification requires Node 22 or 24")
        return subprocess.run(
            [node, "--input-type=module", "-e", NODE_VERIFIER, str(file)],
            cwd=ROOT, capture_output=True, text=True, check=False, timeout=20,
        )

    def test_import_prepare_and_verify_node_override(self) -> None:
        self.install()
        self.install()  # Confirm pre-existing verified catalog reuse.
        override = prepare(self.root, expected=3)
        self.assertEqual(override, self.dest / "tauri-places.conf.json")
        self.assertTrue(override.is_file())
        completed = self.node_check(override)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout, "")
        self.assertEqual(completed.stderr, "")

    def test_tampered_override_is_rejected_after_valid_production(self) -> None:
        self.install()
        override = prepare(self.root, expected=3)
        original = override.read_text(encoding="utf-8")
        self.assertEqual(self.node_check(override).returncode, 0)
        override.write_text(original.replace('"active": true', '"active": false'), encoding="utf-8")
        completed = self.node_check(override)
        self.assertEqual(completed.returncode, 2)
        self.assertNotIn(str(self.root), completed.stdout + completed.stderr)

    def test_modified_catalog_fails_before_override_replacement(self) -> None:
        self.install()
        override = prepare(self.root, expected=3)
        before = override.read_bytes()
        with (self.dest / "world-cities.sqlite").open("ab") as database:
            database.write(b"fictional-tamper")
        with self.assertRaises(ValueError):
            prepare(self.root, expected=3)
        self.assertEqual(override.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
