# Native offline city search

The Tauri command `search_offline_places` opens the fixed bundled resource `places/world-cities.sqlite` in read-only mode. The frontend supplies neither filesystem paths nor SQL. The command returns at most 30 places and admits at most two concurrent database queries.

## Query limits and failure behavior

Search text is limited to 80 Unicode scalar values and **at most five alphanumeric/underscore terms**, separated by punctuation or whitespace. Terms become safely quoted FTS5 prefixes; free-form FTS syntax is never executed. A query with fewer than two alphanumeric characters or more than five terms returns `PLACE_QUERY_INVALID`. Extra terms are **rejected, never silently discarded**: ignoring words could cause an unexpected match to be presented as an exact search result. The database is not opened for an invalid query. The frontend currently presents unrecognized validation errors as an unavailable search, without exposing internals.

The native response carries coordinates in microdegrees and the city's IANA time-zone identifier, **not** a computed historical UTC offset. Version 1 catalogs provide no country name; version 2 uses a packaged explicit country lookup and never guesses the ISO country from `state_id`.

## Prototype boundaries

The Settings city picker debounces requests, ignores stale responses, and supports keyboard interaction. Missing packaged data or a browser-only preview results in an explicit unavailable state. The selected city remains in memory: it does not persist or modify the fictional chart. Real astronomical computation, a saved chart library and historical civil-time resolution are not yet integrated here.

The standard build contains no proprietary city catalog. For a separately authorized local overlay, see [Local city packaging](LOCAL_CITY_PACKAGING.md). Before declaring native place search ready, exercise the bundled catalog on Windows/WebView2, including invalid queries, oversize term counts, concurrent requests and distribution rights.

Test source: `src-tauri/src/offline_places.rs` contains Rust unit tests for input bounds, FTS quoting, six-term rejection, concurrency, and synthetic SQLite v1/v2 fixtures. Run `cargo test --locked` in `src-tauri` on an installed Rust toolchain. Passing unit tests alone is not a Windows executable smoke test.
