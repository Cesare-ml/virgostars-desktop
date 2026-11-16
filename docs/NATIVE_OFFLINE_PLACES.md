# Native offline city search

Status: **prototype**. The Tauri `search_offline_places` command opens the fixed `places/world-cities.sqlite` application resource in read-only mode. Angular sends only a query and a bounded result limit, never file paths or SQL. Rust caps each response at 30 places and permits at most two concurrent database searches.

Coordinates are returned in microdegrees; `timeZone` is an IANA identifier, **not** a historically resolved UTC offset. The Settings city picker debounces typing, discards stale replies, and supports keyboard navigation. Missing catalog files and browser-only previews are explicit unavailable states. City selection is currently in-memory only and does **not** change the synthetic chart. No verified real astronomy, historical timezone resolver, chart archive, or cloud sync is supplied by this command.

## FTS5 query safety

The native parser accepts at most 80 Unicode scalar values and at most five **searchable** tokens, each containing two or more alphanumeric scalar values. Single-character fragments (for example, `L` in `L'Aquila` or `d` in `Côte d'Azur`) are skipped to avoid large single-character FTS5 prefix searches. Apostrophes, typographic apostrophes, dashes, underscores, and other separators are not forwarded as FTS syntax. Valid terms are individually quoted and matched as FTS5 prefixes.

If no searchable term remains, or six or more searchable terms are present, Rust returns `PLACE_QUERY_INVALID` rather than submitting a broad query or silently truncating the user's search. The query is also rejected before opening the packaged database when the syntax budget is invalid.

Examples:
- `L'Aquila` → `"Aquila"*`
- `Côte d'Azur` → `"Côte"* "Azur"*`
- `Rio_de_Janeiro` → `"Rio"* "de"* "Janeiro"*`
- `a b` → rejected (no searchable token)
- `San José Toscana Italia Centro Europa` → rejected (six searchable tokens)

**Integration constraint:** frontend query validation must eventually match this native definition. Draft PR #132 currently uses a distinct token-count and minimum-length rule; for example, `a b` passes its JavaScript preflight but is rejected by this native draft. Do not combine the branches without reconciling both contracts and adding cross-language fixture tests. Rust remains the authoritative boundary; UI preflight is for user feedback, not security.

## Validation and release boundary

The Rust unit test module includes a synthetic SQLite/FTS5 fixture exercising apostrophes, Unicode accent prefixes, underscores, token budgets, and the read-only command boundary. On a full authorized checkout, run:

```powershell
cd src-tauri
cargo fmt --check
cargo test --locked offline_places::tests
cd ..
npm run verify:ipc
npm test
```

The source alone is **not** Windows acceptance: test a native Tauri/WebView2 build with an approved local catalog, including missing/corrupted resource, limits and keyboard navigation. The normal source build does not contain private city data. The optional verified catalog overlay and redistribution restrictions are described in [Local city packaging](LOCAL_CITY_PACKAGING.md). Neither the original licensed catalog nor private user records may be committed to tests or this repository.
