# Offline-place IPC: data-only row decoding

**Status: Prototype hardening.** Not yet merged, built in Angular or validated
inside the native Windows WebView2 host.

## Why

`search_offline_places` is read-only and delivers a bounded JSON-like payload to
the Angular renderer. The previous decoder called `items.map(...)` and repeatedly
accessed fields on each result row. For malformed in-process test/adapter values:

- sparse arrays were partially skipped by `Array.map`, so a response could be
  reported `ready` while containing holes;
- accessor-backed fields could be evaluated during validation and then return a
  different value while the UI object was constructed;
- inherited fields could supply values even though a genuine JSON parse would
  produce own data fields;
- throwing accessors or revoked proxies could propagate unexpected messages.

These are defensive IPC-boundary scenarios, not evidence of an actual Rust
exploit. Ordinary Rust/Tauri JSON replies have only own data fields.

## Behavior

The existing `decodeOfflinePlaceResults` contract now:

1. Reads protocol version and result array as **own data** fields, rejecting
   accessors and missing required fields.
2. Iterates all indices explicitly, rejecting holes or accessor array slots.
3. Captures all required city attributes once via own-property descriptors,
   validating exactly those snapshots before constructing a new plain object.
4. Keeps legacy v1 missing `countryName` / `countryCode` as `null`; accepts
   valid explicit v2 country mapping without changing the protocol version.
5. Preserves bounds (30 items, unique positive IDs, microdegrees, string and
   country-code checks) and rejects the whole response on any invalid row.
6. Throws only the sanitized `Invalid offline place protocol` error from this
   boundary, never getter text, paths, SQL, or native details.

The existing caller classifies decoder failures as `unavailable`, preserving
its latest-request-wins handling and no-network behavior. All data remain
synthetic/fictitious in tests. There is no change to Rust queries, catalog
licenses, catalog packaging, account data, chart computation, storage or sync.

## Validation and remaining gates

Focused regression file: `tests/offline-place-own-data.test.mjs`. Cases cover
ordinary v1 and v2 rows, array holes, accessor array indices and fields,
missing/inherited values, malicious proxies, metadata, duplicates and invalid
coordinates.

Run from a clean authorized checkout:

```sh
node --experimental-strip-types --test tests/offline-place-own-data.test.mjs
node --experimental-strip-types --test tests/offline-place-search.test.mjs
npm test
npm run build:ui
```

Then verify an actual Tauri SQLite catalog search in Windows WebView2, including
not-native, missing-catalog and invalid-response error states. Static tests
alone cannot prove native runtime behavior.

A separate draft PR #157 modifies the `OfflinePlaceSearch.search` rejection
classification in the same file. Review and combine both disjoint changes
before merge; do not use unreviewed auto-resolution. No GitHub Actions,
production changes, public-source visibility switch, release or main merge.
