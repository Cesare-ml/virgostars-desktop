# Local city catalog — native SQLite search bridge (v1)

**Status (2026-11-11):** Rust command, TypeScript client and synthetic regression tests authored on a stacked draft PR. **NOT yet compiled/tested in Windows Tauri or with the paid 1,951,599-row SQLite catalog.**

## Progress from the packaging PR

[Local City Packaging](LOCAL_CITY_PACKAGING.md) produces an ignored SQLite database with `places`, `places_fts` and `catalog_meta` tables, plus a SHA-256 manifest; `prepare_tauri_bundle.py` maps it into Tauri resources as `places/world-cities.sqlite`. The full licensed database stays **out of normal Git history**.

This PR adds `src-tauri/src/offline_places.rs`, using Tauri 2's official `AppHandle::path().resolve("places/world-cities.sqlite", BaseDirectory::Resource)`. This path is compiled into the command and **cannot be supplied by Angular**, preventing arbitrary-file selection. Missing resources return `PLACE_CATALOG_UNAVAILABLE`; the synthetic desktop still starts without the catalog.

## Version 1 API

`invoke('search_offline_places', { query: 'Firenz', limit: 12 })` → 

```json
{
  "protocolVersion": 1,
  "items": [{
    "id": 1,
    "name": "Firenze",
    "italianName": "Florence",
    "latMicro": 43769560,
    "lngMicro": 11255810,
    "population": 350000,
    "stateId": 1,
    "region": "Toscana",
    "timeZone": "Europe/Rome"
  }]
}
```

The JSON above is **illustrative synthetic data**, not an excerpt from the purchased dataset. The `stateId` column corresponds to existing `stato_id`: **do not assume it is an ISO country code** until its source lookup table is migrated.

### Native resource and memory constraints

- Rust uses `rusqlite` with `bundled` SQLite and `SQLITE_OPEN_READ_ONLY`. No database creation, SQL writes or PostgreSQL server.
- Only query text and a maximum result count cross IPC; SQLite stays on disk and indexed through FTS5. Coordinates are returned as exact integer microdegrees (divide by 1,000,000 only for display).
- `MAX_RESULTS = 30`, default 12; input at most 80 Unicode code points; at most 5 quoted FTS5 prefix terms; candidate window at most 500. These are bounded *application response* parameters, not a claim that the SQLite query has a strict execution time limit.
- A native atomic gate admits **at most two concurrent worker calculations**. Excess requests fail immediately with `PLACE_SEARCH_BUSY`; no unbounded task queue or accumulation of pending city arrays.
- `tauri::async_runtime::spawn_blocking` runs SQLite outside the WebView2 GUI task thread. DB connections are short-lived and dropped after response. In a later performance pass, benchmark and consider a single persistent read-only connection pool with a fixed capacity; do not share mutable SQLite connections unsafely.
- Native errors are **stable codes**, without local absolute paths, SQL internals, sensitive logs or personal data. Missing/invalid catalog is not silently replaced by an online request.
- A built-in resource/version check reads `catalog_meta.schemaVersion = 1`; full pack SHA-256 is checked before creating the Tauri resource override (not recomputed on every search).

### Angular settings-panel city picker (implemented source, native QA pending)

The existing standalone Angular desktop shell now imports `OfflineCityPickerComponent` and shows a **city search box in the Settings/Parametri inspector**, with full IT/EN status messages and small responsive controls. The UI can render without the purchased catalog (a localized `database not installed` status), uses no network, and does not require VirgoStars login.

- `src/app/offline-city-picker-state.ts`: a **single 180 ms debounce timer**, max 12 results per search, no large in-memory city list, strict latest-request-wins, cleanup on dismissal/close, and arrows/Enter/Escape selection logic. Old native replies/errors cannot replace the current suggestion list.
- `src/app/offline-city-picker.component.{ts,html,css}`: accessible input/listbox with keyboard controls and a limited suggestions area. Use the selected stable source ID and keep original region/timezone metadata.
- `src/app/desktop-app.component.ts` tracks `selectedCity` only in the synthetic UI; changing the input clears the temporary selection. The selection is **not yet persisted** and must **never recalculate the demo wheel as though it represented the chosen real location**.
- **10/10 Node unit tests passed** for the pure controller under Node.js 22.16.0, and its exact committed TypeScript source passed `tsc --noEmit --strict` TypeScript 5.8.3. Browser/real Tauri rendering and full Angular production build have **not** been executed with this change.

The next vertical milestone is a real Windows-native test with the privately generated city pack, matching country names to `stato_id`, historically accurate IANA timezone resolution, and saving the selected place in a local guest chart. The existing chart remains explicitly synthetic until the Rust ephemeris bridge is numerically validated.

## Angular adapter and integration boundary

- `src/app/native/offline-places-contract.ts` validates protocol, bounded item counts, stable positive IDs, coordinate bounds, optional locality fields and duplicate IDs. It suppresses stale native results/errors via monotonically increasing request tickets.
- `src/app/native/offline-places.ts` is the official Tauri v2 `invoke` adapter. It cannot invoke native IPC from a browser-only demo.
- **The visible new-chart city autocomplete is not yet wired**. Its future implementation should debounce typed input (~120–200 ms), cancel/ignore the last query on change/close, show error/loading states, and preserve the selected stable ID/country/region/timezone/coordinates. Do not mark the location field as ready until the picker is connected, the country lookup imported and historical IANA timezone rules validated.
- Current `src-tauri/tauri.conf.json` remains unchanged with `bundle.active=false` for the early synthetic lab. The catalog-enabled installer uses the reviewed ignored config overlay and full private catalog from [LOCAL_CITY_PACKAGING.md](LOCAL_CITY_PACKAGING.md). **A bare .exe from an unbundled Tauri build does not contain the city catalog.**

## Tests authored

Rust tests in `src-tauri/src/offline_places.rs`: quoted-prefix sanitization, two-slot limiter release, read-only synthetic SQLite/FTS5 search, missing-catalog fail closed.

Node tests in `tests/offline-place-search.test.mjs`: TypeScript DTO validation, wrong versions and coordinate bounds, no browser fallback, bounded native invocation, stale results/errors, busy/missing error codes, resource/command registration check.

**Actually validated locally** on Node.js 22.16.0: **10/10 pure TypeScript decoder/client tests passed** using the exact committed TypeScript file (matching Git blob SHA), and `tsc --noEmit --strict` passed for the same module. The extra Rust/source-registration Node test is authored but **has not run** in the complete checkout. **Rust Cargo tests, actual Windows Tauri build and full-catalog IPC remain unverified**, as Rust/Cargo is unavailable in the authoring environment. This is not a release or proof of usable city search UI.

## Windows next tests

From the branch after safe checkout, with the synthetic Python data and authorized local resources:

```powershell
cd D:\GitHub\virgostars-desktop
py -3 -m unittest discover -s tests -p "test_places_*.py" -v
npm.cmd test
cd src-tauri
cargo test
cd ..
```

Then build the actual catalog via [Local City Packaging](LOCAL_CITY_PACKAGING.md), verify manifest, bundle it in an approved Windows installer, and test `search_offline_places` in Tauri without network. Record search latency p50/p95, RSS, response bytes, accent-aware prefixes, short and common names, identical localities across countries, and behavior with catalog missing or corrupted.

The first real shipping milestone additionally requires: a country/state lookup, IANA DST gap/fold validation independent from source `tz_offs`, stable selected-place persistence and Angular city selection UI. No automatic merging, GitHub Actions, publication or use of live birth data.
