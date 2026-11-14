# Offline city search

The read-only Tauri `search_offline_places` command opens a fixed bundled
`places/world-cities.sqlite` resource. Frontend callers cannot supply SQL,
database paths or network endpoints. Each result list contains at most 30
records and at most two native searches run concurrently. Coordinates are in
microdegrees; the IANA time-zone identifier is not a historically verified UTC
offset.

## Complete-query guard

The native FTS5 parser accepts up to **80 Unicode scalar values** and at most
**five meaningful terms** with two or more alphanumeric scalars each, separated
by non-alphanumeric characters (including underscores). One-character fragments
such as the L in `L'Aquila` are ignored, protecting FTS5 against expensive
single-character prefix scans. `a b` is therefore invalid, but `L'Aquila`,
`Côte d'Azur` and `Rio_de_Janeiro` remain searchable. Terms are quoted as
prefixes before they reach FTS5; no arbitrary MATCH syntax is accepted.

**Queries with more than five meaningful terms are rejected entirely**, rather
than silently using only the first five. Queries containing only one-letter
fragments are reported as too short before any IPC is invoked. The Angular
preflight applies the same policy and displays a localized validation message.
Rust remains the ultimate authority for Unicode edge cases and native IPC. The shared JavaScript preflight iterates at most
81 Unicode scalars before returning over-limit, so even large pasted inputs
never allocate an unbounded spread array during validation. Its shared `offline-city-query.js` module is importable by the
Node 22 test runner without a TypeScript-only extensionless import; the
adjacent `.d.ts` supplies strict Angular types. The picker retains at most **81 Unicode scalar values** as
an over-limit sentinel: pasted input cannot become a valid-looking truncated
80-character search, and it cannot be cut halfway through a surrogate pair.
The HTML search field does not apply a competing UTF-16 code-unit limit.
Rust remains the authoritative validation boundary for other callers.
Punctuation and Unicode input receive the same term budget. Only deliberate
single-letter fragments are omitted; additional meaningful terms are never
silently dropped or presented as complete matches.

The picker debounces typing, ignores superseded results, and supports
keyboard selection. A missing native resource or browser-only preview is
reported explicitly. Selection lives only in memory; it does **not** modify
the synthetic chart or persist a personal birth location. Real astronomical
calculation, saved charts and historical time-zone resolution are unavailable.

## Verification and packaging

The native `fts_query` unit tests cover five accepted terms and six rejected
meaningful terms (spaces and punctuation), ignored single-letter fragments,
and quoted Unicode place names. The Node search and picker-state tests cover
client preflight, zero IPC dispatch and cancellation
of already queued requests. Run:

```sh
node --experimental-strip-types --test tests/offline-place-search.test.mjs tests/offline-city-picker-state.test.mjs
cd src-tauri && cargo test offline_places
```

The standard synthetic build contains no protected city catalog. To package
an authorized catalog use [Offline catalog packaging](LOCAL_CITY_PACKAGING.md).
Before declaring the feature integrated, perform a real Windows WebView2
offline build and inspect results and local time-zone metadata. Neither
synthetic tests nor documentation grant rights to redistribute the catalog.
