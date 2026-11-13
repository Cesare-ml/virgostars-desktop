# Offline locality search

**Status: experimental / native Windows acceptance pending.**

The Tauri `search_offline_places` command opens only the bundled `places/world-cities.sqlite` resource in read-only mode. The frontend cannot provide a file path or SQL expression. The command returns at most 30 matches and admits at most two concurrent searches. Coordinates use microdegrees; the supplied IANA time zone is an identifier, not a computed historical UTC offset.

## Query bounds and accuracy

The native query permits up to **80 Unicode characters** and **five non-empty search terms**. It converts each term to a quoted FTS5 prefix; it never passes an arbitrary frontend-supplied FTS expression to SQLite. An empty search, a one-character search, an overlong search, or **more than five terms** returns `PLACE_QUERY_INVALID`. The six-term case must be rejected rather than silently discarding the sixth term, which could otherwise return matches that do not satisfy the user's full query. Terms may be separated by spaces or punctuation. No search text is logged or transmitted over a network.

The Settings locality picker debounces typed requests, ignores stale completions, and supports keyboard selection. The UI reports unavailable native resources or a browser-only preview without pretending the catalog exists. The current generic query-error handling is not yet a dedicated user-facing “too many search terms” message; this is a small native correctness guard, **not** a complete locality-search UX validation.

## Privacy and integration

The selected city is held in memory and does not alter the synthetic chart or create a saved birth location. Real astronomical calculation, natal-chart storage, and historically ambiguous local-time resolution are not implemented by this search command.

The standard source build includes no protected catalog. A separately authorized catalog must be supplied through the checked override described in [Local city packaging](LOCAL_CITY_PACKAGING.md). Source publication does not grant redistribution rights for the catalog.

## Verification

The Rust unit module `src-tauri/src/offline_places.rs` includes positive five-term searches and negative six-term searches with both whitespace and punctuation separators, alongside existing bound, FTS5, and concurrency tests.

From a development checkout with Rust/MSVC prerequisites installed, run:

```powershell
cd src-tauri
cargo test offline_places::tests::
```

Before release, verify the actual resource-backed query, the error display, and offline WebView2 behavior on Windows. No network, auth, release, or backend changes are required for this guard.
