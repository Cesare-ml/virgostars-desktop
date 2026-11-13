"""Synthetic, private-data-free checks for the optional Tauri city pack override."""
import hashlib
from contextlib import closing
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "places" / "prepare_tauri_bundle.py"
spec = importlib.util.spec_from_file_location("prepare_tauri_bundle", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PrepareTauriBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "project"
        self.pack = self.root / ".local" / "places"
        self.pack.mkdir(parents=True)
        self.catalog = self.pack / "world-cities.sqlite"
        self.manifest = self.pack / "world-cities.manifest.json"
        with closing(sqlite3.connect(self.catalog)) as conn:
            conn.execute("CREATE TABLE catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            conn.executemany("INSERT INTO catalog_meta VALUES (?, ?)", [
                ("rowCount", "2"), ("schemaVersion", "1")
            ])
            conn.commit()
        self.write_manifest()

    def write_manifest(self):
        self.manifest.write_text(json.dumps({
            "schemaVersion": 1, "rowCount": 2, "file": self.catalog.name,
            "bytes": self.catalog.stat().st_size,
            "sha256": hashlib.sha256(self.catalog.read_bytes()).hexdigest(),
        }), encoding="utf-8")

    def test_generates_canonical_resource_only_override(self):
        out = module.prepare(self.root, expected=2)
        self.assertEqual(out, self.pack / "tauri-places.conf.json")
        self.assertEqual(json.loads(out.read_text(encoding="utf-8")), {
            "bundle": {"active": True, "resources": {
                "../.local/places/world-cities.sqlite": "places/world-cities.sqlite",
                "../.local/places/world-cities.manifest.json": "places/world-cities.manifest.json",
            }}
        })
        self.assertEqual(out.read_bytes()[-1:], b"\n")
        self.assertEqual(list(self.pack.glob(".tauri-places-*.tmp")), [])

    def test_second_generation_replaces_same_file(self):
        first = module.prepare(self.root, expected=2)
        original = first.read_bytes()
        first.write_text("incomplete", encoding="utf-8")
        self.assertEqual(module.prepare(self.root, expected=2).read_bytes(), original)

    def test_rejects_changed_manifest_before_output(self):
        data = json.loads(self.manifest.read_text())
        data["sha256"] = "0" * 64
        self.manifest.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaises(ValueError):
            module.prepare(self.root, expected=2)
        self.assertFalse((self.pack / "tauri-places.conf.json").exists())

    def test_rejects_symlinked_catalog_and_manifest(self):
        for path in (self.catalog, self.manifest):
            with self.subTest(name=path.name):
                real = self.pack / (path.name + ".original")
                path.rename(real)
                try:
                    try:
                        path.symlink_to(real)
                    except (NotImplementedError, OSError):
                        self.skipTest("OS does not permit test symlinks")
                    with self.assertRaisesRegex(ValueError, "symbolic links"):
                        module.prepare(self.root, expected=2)
                finally:
                    path.unlink(missing_ok=True)
                    real.rename(path)

    def test_refuses_symlinked_override_without_touching_target(self):
        outside = self.root / "keep-me.txt"
        outside.write_text("preserve", encoding="utf-8")
        override = self.pack / "tauri-places.conf.json"
        try:
            override.symlink_to(outside)
        except (NotImplementedError, OSError):
            self.skipTest("OS does not permit test symlinks")
        with self.assertRaisesRegex(ValueError, "symbolic-link Tauri"):
            module.prepare(self.root, expected=2)
        self.assertEqual(outside.read_text(encoding="utf-8"), "preserve")

    def test_manifest_read_is_bounded_to_archive_import_limit(self):
        self.manifest.write_bytes(b" " * (module.MAX_MANIFEST_BYTES + 1))
        with self.assertRaisesRegex(ValueError, "manifest size"):
            module.prepare(self.root, expected=2)
        self.assertFalse((self.pack / "tauri-places.conf.json").exists())

    def test_rejects_duplicate_manifest_keys(self):
        text = self.manifest.read_text(encoding="utf-8")
        self.assertIn('"rowCount": 2', text)
        self.manifest.write_text(
            text.replace('"rowCount": 2', '"rowCount": 2, "rowCount": 2', 1),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(ValueError, "manifest JSON"):
            module.prepare(self.root, expected=2)

    def test_rejects_boolean_manifest_numbers(self):
        for key in ("schemaVersion", "rowCount", "bytes"):
            with self.subTest(field=key):
                self.write_manifest()
                info = json.loads(self.manifest.read_text(encoding="utf-8"))
                info[key] = True
                self.manifest.write_text(json.dumps(info), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "metadata"):
                    module.prepare(self.root, expected=2)

    def test_rejects_invalid_utf8_and_nonobject_manifest(self):
        for raw in (b"\xff", b"[]", b"null"):
            with self.subTest(raw=raw):
                self.manifest.write_bytes(raw)
                with self.assertRaises(ValueError):
                    module.prepare(self.root, expected=2)

    def test_v2_country_count_requires_integer_not_boolean(self):
        with closing(sqlite3.connect(self.catalog)) as conn:
            conn.execute("UPDATE catalog_meta SET value='2' WHERE key='schemaVersion'")
            conn.execute("CREATE TABLE country_lookup (stato_id INTEGER PRIMARY KEY)")
            conn.execute("INSERT INTO country_lookup VALUES (1)")
            conn.commit()
        self.write_manifest()
        info = json.loads(self.manifest.read_text(encoding="utf-8"))
        info["schemaVersion"] = 2
        info["countryLookupCount"] = 1
        self.manifest.write_text(json.dumps(info), encoding="utf-8")
        self.assertTrue(module.prepare(self.root, expected=2).is_file())
        info["countryLookupCount"] = True
        self.manifest.write_text(json.dumps(info), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Country lookup"):
            module.prepare(self.root, expected=2)

    def test_failed_replace_preserves_prior_override_and_removes_temp(self):
        override = module.prepare(self.root, expected=2)
        previous = override.read_bytes()
        with patch.object(module.os, "replace", side_effect=OSError("synthetic replace failure")):
            with self.assertRaises(OSError):
                module.prepare(self.root, expected=2)
        self.assertEqual(override.read_bytes(), previous)
        self.assertEqual(list(self.pack.glob(".tauri-places-*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
