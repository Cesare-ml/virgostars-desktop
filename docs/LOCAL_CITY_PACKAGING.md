# Offline city catalog — how to prepare and distribute all 1,951,599 places

**Approved direction: 2026-11-11:** bundle the entire purchased worldwide catalog for offline use from first launch, after a local conversion and rights check. **Status: converter and packaging tools are authored; no purchased records or built SQLite binary have been uploaded; Rust read-only search IPC and a TypeScript adapter have been written in draft code, but the Angular picker is not wired and Windows native tests are pending.** See [Native Offline Search](NATIVE_OFFLINE_PLACES.md).

## Source and measured dimensions

The owner's existing PostgreSQL has **1,951,599 rows**, `284 MB of table heap, `310 MB of indexes, `595 MB total (reported rounded). Fields observed: `id`, `nome`, `nome_it`, `lat`, `lng`, `pop`, `stato_id`, `regione`, `tz`, `tz_offs`. The source table name is still unknown here. `tz` is an IANA-style zone ID and `tz_offs` is **not** a safe historic birth-time offset.

The user confirms the purchased catalog can be used in the project, but **public redistribution in an open-source/free desktop installer** and source attribution must still be checked against the original purchase terms before publishing a release.

## Where everything goes

Do **NOT** `git add` the PostgreSQL dump, 1,951,599-row CSV or generated SQLite into normal Git history. The repo contains **only converter code, schemas, test fixtures created locally, checksum format, and assembly instructions**.

Expected layout on the developer's Windows PC:

```text
D:\GitHub\virgostars-desktop\
  scripts\places\build_catalog.py           # TRACKED
  scripts\places\prepare_tauri_bundle.py    # TRACKED
  tests\test_places_build_catalog.py         # TRACKED, synthetic-only
  .local\places\cities.csv                   # IGNORED / PRIVATE INPUT
  .local\places\world-cities.sqlite          # IGNORED / GENERATED OFFLINE DATABASE
  .local\places\world-cities.manifest.json   # IGNORED / GENERATED SHA-256
  .local\places\world-cities.zip             # IGNORED / OPTIONAL RELEASE ASSET
  .local\places\tauri-places.conf.json       # IGNORED / GENERATED TAURI OVERLAY
```

`.local/` is already in the repository's `.gitignore`. A future *public* VirgoStars Desktop source repository will not expose the purchased database, although the **binary installer itself** can include the catalog **only if redistribution is licensed**.

### 1. Export owned PostgreSQL data to a PRIVATE local CSV

Open a `psql` console (with your own host/database/user authentication; never store a password in scripts or screenshots) and run the following **client-side `\copy`**, changing `public.NOME_TABELLA` to the real source table name:

```sql
\copy (SELECT id, nome, nome_it, lat, lng, pop, stato_id, regione, tz, tz_offs FROM public.NOME_TABELLA ORDER BY id) TO 'D:/GitHub/virgostars-desktop/.local/places/cities.csv' WITH (FORMAT CSV, HEADER TRUE, ENCODING 'UTF8')
```

Create the destination first:

```powershell
cd D:\GitHub\virgostars-desktop
New-Item -ItemType Directory -Force .\.local\places | Out-Null
```

The `\copy` runs on the **client**, writing a file on the local Windows machine. If using the pgAdmin graphical export, select CSV, UTF-8, a header row, and exactly these **10 columns** in this order. Keep the CSV private: do not attach it to GitHub issues or PRs. Do not export any unrelated PostgreSQL tables, credentials or birth records.

### 2. Convert the complete file into a read-only SQLite catalog

The converter uses only Python 3 standard modules (`sqlite3`, `csv`, `hashlib`, `zipfile`, etc.). From PowerShell:

```powershell
cd D:\GitHub\virgostars-desktop
py -3 scripts\places\build_catalog.py build --csv .local\places\cities.csv --out .local\places\world-cities.sqlite --expected-rows 1951599 --zip
```

It streams records in batches (does not load the entire CSV into RAM), validates IDs and coordinates, converts six-decimal coordinates to lossless integer microdegrees, creates an **FTS5 external-content** index for `nome` and `nome_it`, checks SQLite integrity, and emits an SHA-256 manifest plus a compressed ZIP (optional `--zip` flag).

The converter refuses to overwrite a previous output and **fails if the imported count differs from 1,951,599**. Work stays local. The SQLite file has an indexed table `places` plus `places_fts`, `catalog_meta`; `stato_id` and region are preserved, but the **actual country lookup table still needs a separate approved import before the production city picker can show country names reliably**.

Test a lookup:

```powershell
py -3 scripts\places\build_catalog.py search --db .local\places\world-cities.sqlite --query "Firenze"
```

Then inspect the output sizes (the original PostgreSQL indexes do not transfer directly):

```powershell
Get-Item .local\places\world-cities.sqlite, .local\places\world-cities.zip |
  Select-Object Name, @{N='MiB';E={[math]::Round($_.Length/1MB,1)}}
```

Use the measured SQLite, FTS and ZIP bytes to choose packaging; do not assume the new file necessarily weighs 284 MB or that it will fit an arbitrary installer limit.

### 3. Prepare the Tauri 2 resource configuration (without changing the default demo)

```powershell
py -3 scripts\places\prepare_tauri_bundle.py
```

This verifies the manifest SHA-256/size/count and creates an ignored override file:

```json
{
  "bundle": {
    "active": true,
    "resources": {
      "../.local/places/world-cities.sqlite": "places/world-cities.sqlite",
      "../.local/places/world-cities.manifest.json": "places/world-cities.manifest.json"
    }
  }
}
```

Tauri 2 supports **bundled resources** and `--config` JSON merge patches. When an actual Windows installer workflow is approved and validated:

```powershell
npm.cmd run build:ui
npm.cmd run prepare:icon
npx.cmd tauri build --config .local/places/tauri-places.conf.json
```

**Important:** the current experimental Tauri configuration has `bundle.active=false`. A normal bare `.exe` output is **not the same thing as an installer**. This override enables installer bundling **only for an explicit build**, preserving the existing synthetic prototype. The SQLite is a resource file in the installed application, **not an Angular/Three.js asset, remote URL, JavaScript bundle or complete in-memory array**.

Before any production claim, the Rust host must resolve `places/world-cities.sqlite` from Tauri's **resource directory** using `BaseDirectory::Resource`, open it `mode=ro` and expose a **bounded, cancellable typed search command** through Tauri IPC. Angular should show only `limit` local results per query and never receive the whole SQLite database. **That reader, the country-name mapping and the city-picker UI are not implemented in this change.**

Official Tauri reference: https://v2.tauri.app/develop/resources/ .

### 4. How this relates to GitHub

- **Source repo `Cesare-ml/virgostars-desktop`:** commit conversion scripts, tests, manifest *format*, build instructions and code for the Rust search adapter. **Do not commit the purchased CSV/SQLite/ZIP.**
- **While the repo is private:** once the ZIP has been generated and audited, upload `world-cities.zip` manually as an asset of a **draft/private GitHub Release** (or a separate controlled private data repository's Release, if source and data permissions need segregation). Authorized developers can download it to the ignored local folder for reproducible packaging. GitHub Releases allow individual files under **2 GiB**. The ZIP's SHA-256 and dataset version belong in a small reviewed manifest.
- **When source code becomes public:** a public source checkout remains lightweight and free of proprietary data. A legally redistributable, signed Windows installer can **bundle the catalog resource** to work completely offline immediately. Source code developers without rights to purchased data use the approved synthetic fixture / a separately licensed public reference pack. A private GitHub Release is **not publicly downloadable**, so do not design the released app to require private GitHub credentials.
- **Do not use Git LFS by default:** it makes every clone/version consume large binary bandwidth and risks accidentally publishing a licensed source. GitHub blocks regular repository files >100 MiB. GitHub Releases are for downloadable binary artifacts rather than Git history.

GitHub docs: https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases and https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github .

### 5. Tests / release blockers

```powershell
py -3 -m unittest discover -s tests -p "test_places_*.py" -v
```

Tests use **synthetic** geographic records; no purchased rows are embedded. Test covers FTS5, accents, aliases, six-decimal coordinates, wrong row counts, duplicate IDs, corrupt manifest, ZIP packaging and refusing to overwrite an existing catalog.

Before shipping:
- [ ] Validate original purchase's right to embed and redistribute the source city records in a free installer, and any license notice requirements.
- [ ] Export exactly 1,951,599 cities and generate/review actual SQLite, ZIP sizes and SHA-256.
- [ ] Inspect/convert country lookup table for `stato_id`, duplicate names, timezone validity and historic DST behavior (via versioned IANA tzdb, not `tz_offs`).
- [ ] Test search latency / RAM p50/p95 on ordinary Windows hardware; optimize FTS and query ranking based on evidence.
- [ ] Implement Rust read-only place search via Tauri IPC and Angular autocomplete; no large data arrays in frontend.
- [ ] Build Windows installer with verified resource presence, offline startup, no account, and correct user-selected location after restart.
- [ ] Establish signed catalog version/update strategy without touching saved personal chart snapshots.

**Status:** importer and bundle-preparation code authored in a draft PR; **real purchased data, full-size build and native Windows package have not yet been executed**.
