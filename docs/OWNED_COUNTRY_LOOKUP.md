# Owned offline city catalog — mapping `stato_id` to countries

**Status: conversion and cross-layer compatibility code authored, 2026-11-11. Actual PostgreSQL country table has NOT been inspected and no purchased records have been exported or committed.**

## Why a second file?

The 1,951,599-row city dataset has `stato_id` (integer), `nome`, `nome_it`, `regione`, `lat`, `lng` and an IANA-style `tz`. The `stato_id` number is the **source database's own foreign identifier**, NOT an ISO country code. Assigning `countryName` or ISO2 by numeric guess would mislabel places. Country lookup must come from an explicitly verified owner-provided mapping.

We retain the full unmodified city source IDs, Unicode names and six-decimal coordinates. We do not include the purchased cities or country lookup in source-control fixtures.

## Accepted private mapping CSV

The importer accepts an **optional private file** named, for example, `.local/places/countries.csv` with headers:

```csv
stato_id,country_name,iso2
100,Italia,IT
200,Costa Rica,CR
```

**The two sample IDs and rows above are fictional test mappings**, not values extracted from the purchased collection. Replace them with the real `stato_id` relationships in the original database.

- `stato_id`: source integer key used in the city table, unique and positive
- `country_name`: non-empty country display name (up to 255 characters)
- `iso2`: optional country code with exactly two Latin letters, normalized uppercase; blank if not reliably available
- All **non-null** `stato_id` values referenced by exported cities must exist in the mapping. Missing and duplicate mappings abort the entire pack conversion without publishing a new SQLite file.
- Do not assume column names/table names for the actual purchased state/country relation. Inspect its real PostgreSQL schema first and export the three normalized fields through read-only `SELECT` or client-side `\copy`.
- The public/source Git repository never receives either input CSV or the generated SQLite/ZIP.

## Convert (with a privately verified country mapping)

```powershell
cd D:\GitHub\virgostars-desktop
py -3 scripts\places\build_catalog.py build `
  --csv .local\places\cities.csv `
  --countries-csv .local\places\countries.csv `
  --out .local\places\world-cities.sqlite `
  --expected-rows 1951599 --zip

py -3 scripts\places\build_catalog.py search `
  --db .local\places\world-cities.sqlite --query "Firenze"

py -3 scripts\places\prepare_tauri_bundle.py
```

The country-enriched package uses `catalog_meta.schemaVersion=2` and adds a compact read-only `country_lookup` table, keyed by the original `stato_id`. The manifest includes `countryLookupCount`; the package helper verifies the actual schema, count, hash and row count before producing the Tauri resource override.

**Without `--countries-csv`**, the prior v1 pack remains available. Rust continues reading v1 with `countryName: null` and `countryCode: null`, never guessing. Rust v2 uses a fixed `LEFT JOIN country_lookup` query, while Angular shows the mapped country name only when present. The TypeScript decoder accepts old v1 responses as well as new fields and validates ISO2 codes.

The chosen city is still an **unsaved preview** and does not yet compute a real chart. Switching inspector tabs restores the temporary selection, but closing the app still loses it; this is intentional until the guest archive is integrated. Persisting selected country, coordinates, IANA timezone and a stable source ID in the local guest archive requires a separate storage integration.

## Tests and acceptance

- Synthetic Python tests cover v1 conversion, complete v2 mapping, missing/duplicate/invalid `stato_id`, invalid ISO2, v2 manifest tampering and correct country names in the offline search CLI.
- Synthetic Rust test verifies a v2 SQLite country name/ISO2 is returned for a source ID, and a v1 test verifies absent mapping returns `None`.
- TypeScript decoder tests include legacy payloads, v2 mapped country names and rejected invalid codes/types.
- **These new tests are authored, but not yet executed in a complete Windows checkout.** Do not call this a verified native catalog release until the following pass locally.

```powershell
py -3 -m unittest discover -s tests -p "test_places_*.py" -v
npm.cmd test
cd src-tauri
cargo test
```

After the real city + country CSV exports, build the verified pack and test a first-run native installer with Internet disconnected. Confirm different countries sharing city names are clearly disambiguated. Measure file size, peak RAM, p50/p95 autocomplete and historical time-zone handling; `tz_offs` is not historic DST evidence.

**Privacy/security:** location lookup is offline and read-only, not connected to a user account or cloud service. Do not upload purchased data or user birth details to GitHub. Review purchased-data redistribution rights and full country/timezone provenance before publishing a signed installer.
