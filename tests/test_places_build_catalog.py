"""Synthetic-only regression tests: NEVER include records from the purchased data."""
import csv
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "places"))
from build_catalog import build_catalog, convert_row, microdegrees, search_catalog  # noqa: E402
from prepare_tauri_bundle import prepare  # noqa: E402

COLS = ("id", "nome", "nome_it", "lat", "lng", "pop", "stato_id", "regione", "tz", "tz_offs")


class CityPackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.csvfile = self.root / "private_fixture.csv"
        self.out = self.root / "world-cities.sqlite"
        self.cities = [
            ["1", "Firenze", "Florence", "43.769560", "11.255810", "360000", "100", "Toscana", "Europe/Rome", "+0100"],
            ["2", "Firenze Piccola", "", "40.100000", "12.200000", "", "100", "Lazio", "Europe/Rome", "+0100"],
            ["3", "San José", "", "9.933300", "-84.083300", "350000", "200", "San José", "America/Costa_Rica", "-0600"],
        ]
        self.write(self.cities)

    def write(self, data):
        with self.csvfile.open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(COLS)
            writer.writerows(data)

    def test_full_synthetic_build_and_integrity_manifest(self):
        result = build_catalog(self.csvfile, self.out, expected_rows=3)
        self.assertEqual(result["rowCount"], 3)
        self.assertGreater(result["bytes"], 0)
        self.assertEqual(len(result["sha256"]), 64)
        self.assertEqual(json.loads(self.out.with_suffix(".manifest.json").read_text())["sha256"], result["sha256"])
        with sqlite3.connect(self.out) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM places").fetchone()[0], 3)
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(db.execute("SELECT lat_micro,lng_micro FROM places WHERE id=1").fetchone(), (43769560, 11255810))

    def test_unicode_prefix_and_italian_alias_search(self):
        build_catalog(self.csvfile, self.out, expected_rows=3)
        self.assertEqual(search_catalog(self.out, "Firenze", 3)[0]["nome"], "Firenze")
        self.assertEqual(search_catalog(self.out, "flor", 3)[0]["id"], 1)
        self.assertEqual(search_catalog(self.out, "Jose", 3)[0]["nome"], "San José")

    def test_rejects_missing_columns_without_publishing(self):
        with self.csvfile.open("w", encoding="utf-8", newline="") as f:
            f.write("id,nome\n1,Fake\n")
        with self.assertRaises(ValueError):
            build_catalog(self.csvfile, self.out, expected_rows=1)
        self.assertFalse(self.out.exists())

    def test_wrong_row_count_aborts_without_output(self):
        with self.assertRaisesRegex(ValueError, "Row count mismatch"):
            build_catalog(self.csvfile, self.out, expected_rows=1)
        self.assertFalse(self.out.exists())
        self.assertFalse(self.out.with_suffix(".manifest.json").exists())

    def test_bad_geo_precision_and_missing_name_rejected(self):
        self.assertEqual(microdegrees("-180.000000", 180), -180000000)
        for value in ["181", "12.1234567", "NaN", "Infinity", ""]:
            with self.assertRaises(ValueError):
                microdegrees(value, 180)
        blank = dict(zip(COLS, self.cities[0]))
        blank["nome"] = ""
        with self.assertRaises(ValueError):
            convert_row(blank)

    def test_duplicate_ids_fail_without_partial_publish(self):
        self.write(self.cities + [self.cities[0]])
        with self.assertRaises(sqlite3.IntegrityError):
            build_catalog(self.csvfile, self.out, expected_rows=4)
        self.assertFalse(self.out.exists())

    def test_existing_catalog_is_never_overwritten(self):
        build_catalog(self.csvfile, self.out, expected_rows=3)
        previous = self.out.read_bytes()
        with self.assertRaises(FileExistsError):
            build_catalog(self.csvfile, self.out, expected_rows=3)
        self.assertEqual(self.out.read_bytes(), previous)

    def test_archive_zip_contains_catalog_and_checksum_manifest(self):
        build_catalog(self.csvfile, self.out, expected_rows=3, make_zip=True)
        with zipfile.ZipFile(self.out.with_suffix(".zip")) as z:
            self.assertEqual(sorted(z.namelist()), ["world-cities.manifest.json", "world-cities.sqlite"])

    def test_empty_or_sql_injection_like_queries_are_safe(self):
        build_catalog(self.csvfile, self.out, expected_rows=3)
        self.assertEqual(search_catalog(self.out, ""), [])
        self.assertEqual(search_catalog(self.out, "\" OR 1=1 --"), [])
        self.assertEqual(search_catalog(self.out, "Florence", limit=1000), [])

    def test_tauri_packaging_override_includes_verified_catalog(self):
        target = self.root / ".local" / "places" / "world-cities.sqlite"
        build_catalog(self.csvfile, target, expected_rows=3)
        config_file = prepare(self.root, expected=3)
        result = json.loads(config_file.read_text())
        self.assertTrue(result["bundle"]["active"])
        resources = result["bundle"]["resources"]
        self.assertIn("../.local/places/world-cities.sqlite", resources)
        self.assertEqual(resources["../.local/places/world-cities.sqlite"], "places/world-cities.sqlite")

    def test_tauri_packaging_fails_on_tampered_manifest(self):
        target = self.root / ".local" / "places" / "world-cities.sqlite"
        build_catalog(self.csvfile, target, expected_rows=3)
        manifest_file = target.with_suffix(".manifest.json")
        details = json.loads(manifest_file.read_text())
        details["sha256"] = "0" * 64
        manifest_file.write_text(json.dumps(details))
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            prepare(self.root, expected=3)



if __name__ == "__main__":
    unittest.main()
