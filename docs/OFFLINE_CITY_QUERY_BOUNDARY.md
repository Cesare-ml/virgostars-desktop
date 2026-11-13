# Offline city search — complete-query token boundary

**Status:** Rust-only prototype hardening (draft). This does not make the city dataset redistributable or turn the desktop prototype into a supported release.

## Why the guard matters

The read-only `search_offline_places` Tauri command converts human input into quoted SQLite FTS5 prefix terms. The parser accepts at most **80 Unicode scalar values** in the input, requires **at least two alphanumeric characters**, and caps the query at **five nonempty search terms**. Native result limits remain 1–30. The database resource path is host-owned and is never supplied by the frontend.

Previously the parser used `.take(MAX_TOKENS)`. A six-term query could silently search only its first five terms and return results as though the full query had been honored. That could select an unintended location in downstream UI flows.

The revised implementation peeks at a sixth term (`MAX_TOKENS + 1`) and returns no query when the count exceeds the bound. The command and local search function continue to return the existing **`PLACE_QUERY_INVALID`** error. Separator-only trailing punctuation is not counted as another term. This preserves the existing interface and bounded-work behavior: at most six formatted terms are constructed, regardless of overall input.

## Scope and verification

- Changed: `src-tauri/src/offline_places.rs`; no Tauri command added, database schema changed, new permission, network call or private dataset required.
- Rust unit regression covers five terms, six terms separated by spaces or punctuation, trailing separators, and rejection **before opening** a database.
- In a Windows development checkout run `cd src-tauri; cargo test --locked`. The synthetic SQLite tests need no original city catalog.
- Follow with `npm run verify:ipc` and a manual offline city-picker check, including a six-term query and a subsequent valid search.

The Rust tests have not been run in the authoring environment unless separately reported in the PR: there is no Rust toolchain here. A code inspection or JavaScript source check is not a substitute for `cargo test` or a Windows Tauri/WebView2 test.

The native search is provisional and does not promise global population ranking beyond its bounded 500-candidate FTS selection. It does not activate real ephemerides, accounts, sync, archive writes or installers. Keep the source CPAL-1.0 attribution and protect the licensed place catalog.
