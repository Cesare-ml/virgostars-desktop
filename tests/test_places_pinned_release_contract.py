"""Fail-closed release-fingerprint tests, using only small fictional SQLite packs."""
from __future__ import annotations

from contextlib import closing
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts" / "places"


def load_module(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


prepare_module = load_module("prepare_tauri_bundle")
fetch_module = load_module("fetch_catalog")


class PinnedPlacesReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="vs-pinned-places-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.pack = self.root / ".local" / "places"
        self.pack.mkdir(parents=True)
        self.catalog = self.pack / "world-cities.sqlite"
        self.manifest = self.pack / "world-cities.manifest.json"

    def write_synthetic_pack(self, claimed_rows: int, schema: int = 2):
        with closing(sqlite3.connect(self.catalog)) as connection:
            with connection:
                connection.execute("CREATE TABLE catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
                connection.executemany(
                    "INSERT INTO catalog_meta (key, value) VALUES (?, ?)",
                    [("rowCount", str(claimed_rows)), ("schemaVersion", str(schema))],
                )
                if schema == 2:
                    connection.execute("CREATE TABLE country_lookup (code TEXT PRIMARY KEY)")
                    connection.executemany(
                        "INSERT INTO country_lookup (code) VALUES (?)",
                        [(f"FICTIONAL-{i:03d}",) for i in range(244)],
                    )
        metadata = {
            "file": self.catalog.name, "schemaVersion": schema, "rowCount": claimed_rows,
            "bytes": self.catalog.stat().st_size,
            "sha256": hashlib.sha256(self.catalog.read_bytes()).hexdigest(),
        }
        if schema == 2:
            metadata["countryLookupCount"] = 244
        self.manifest.write_text(json.dumps(metadata), encoding="utf-8")

    def test_release_identity_stays_aligned_with_verified_importer(self):
        self.assertEqual(prepare_module.EXPECTED_ROWS, fetch_module.ROW_COUNT)
        self.assertEqual(prepare_module.PINNED_DATABASE_BYTES, fetch_module.DATABASE_SIZE)
        self.assertEqual(prepare_module.PINNED_DATABASE_SHA256, fetch_module.DATABASE_SHA256)
        self.assertEqual(prepare_module.PINNED_COUNTRY_LOOKUP_COUNT, 244)

    def test_rejects_self_consistent_forged_production_pack(self):
        # The declared row count and country count match the release, and the
        # manifest SHA-256 matches the synthetic DB, but the DB is not the pinned one.
        self.write_synthetic_pack(prepare_module.EXPECTED_ROWS)
        with self.assertRaisesRegex(ValueError, "pinned private release"):
            prepare_module.prepare(self.root)
        self.assertFalse((self.pack / "tauri-places.conf.json").exists())

    def test_rejects_wrong_digest_even_if_pinned_size_were_equal(self):
        self.write_synthetic_pack(prepare_module.EXPECTED_ROWS)
        with patch.object(prepare_module, "PINNED_DATABASE_BYTES", self.catalog.stat().st_size):
            with self.assertRaisesRegex(ValueError, "pinned private release"):
                prepare_module.prepare(self.root)
        self.assertFalse((self.pack / "tauri-places.conf.json").exists())

    def test_allows_explicit_tiny_synthetic_library_fixture_only(self):
        self.write_synthetic_pack(3)
        self.assertTrue(prepare_module.prepare(self.root, expected=3).is_file())

    def test_cli_refuses_synthetic_row_count_override(self):
        self.write_synthetic_pack(3)
        result = subprocess.run(
            [sys.executable, str(SCRIPTS / "prepare_tauri_bundle.py"),
             "--root", str(self.root), "--expected-rows", "3"],
            capture_output=True, text=True, timeout=15, check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("pinned production row count", result.stderr)
        self.assertFalse((self.pack / "tauri-places.conf.json").exists())


if __name__ == "__main__":
    unittest.main()
