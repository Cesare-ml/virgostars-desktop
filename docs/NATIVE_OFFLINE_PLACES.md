# Offline city search

The read-only Tauri `search_offline_places` command opens a fixed bundled
`places/world-cities.sqlite` resource. Frontend callers cannot supply SQL,
database paths or network endpoints. Each result list contains at most 30
records and at most two native searches run concurrently. Coordinates are in
microdegrees; the IANA time-zone identifier is not a historically verified UTC
offset.

## Complete-query guard

The native FTS5 parser accepts up to **80 Unicode characters**, at least two
alphanumeric characters, and at most **five nonempty terms** separated by
non-alphanumeric characters other than underscores. Terms are quoted as
prefixes before they reach FTS5; no arbitrary MATCH syntax is accepted.

**Queries with six or more terms are now rejected entirely**, rather than
silently using only the first five terms. The Angular preflight uses the same
five-term budget and displays a localized length warning without invoking
native IPC. The picker retains at most **81 Unicode scalar values** as
an over-limit sentinel: pasted input cannot become a valid-looking truncated
80-character search, and it cannot be cut halfway through a surrogate pair.
The HTML search field does not apply a competing UTF-16 code-unit limit.
Rust remains the authoritative validation boundary for other callers.
Punctuation and Unicode input receive the same term budget; the search never
drops an unsearched term and presents a partial match as if it were complete.

The picker debounces typing, ignores superseded results, and supports
keyboard selection. A missing native resource or browser-only preview is
reported explicitly. Selection lives only in memory; it does **not** modify
the synthetic chart or persist a personal birth location. Real astronomical
calculation, saved charts and historical time-zone resolution are unavailable.

## Verification and packaging

The native `fts_query` unit tests cover five accepted terms and six rejected
terms (spaces, punctuation and short one-letter tokens). The Node search and
picker-state tests cover client preflight, zero IPC dispatch and cancellation
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
