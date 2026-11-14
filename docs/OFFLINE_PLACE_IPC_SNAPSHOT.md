# Offline city search — strict IPC snapshot validation

**Status:** prototype, pending integration and native Windows/WebView2 acceptance.

## Problem and fix

The TypeScript decoder originally used `Array.map` after checking only the
result count. JavaScript `map` silently skips sparse array holes. A malformed
native result could therefore be reported as ready with a hole instead of a
validated city. It also read object fields repeatedly during checks and output
construction, so accessor-backed values could differ between validation and
display.

`decodeOfflinePlaceResults` now:

- accepts only a version 1 response with own, enumerable, data-only
  `protocolVersion` and `items` fields;
- accepts a normal, dense Array with no extra own keys and at most 30 entries;
  rejects sparse slots, array subclasses, inherited indices and getter indices;
- accepts ordinary or null-prototype records with required own data fields;
  rejects accessors, inherited or hidden non-enumerable required fields;
- reads required fields exactly once, with only `countryName` and
  `countryCode` optional to preserve compatibility with older v1 city packs;
- reuses the existing type, coordinate, country code, duplicate ID and bounded
  text validation; returns detached, frozen records in a frozen result array.

Malformed native responses are still mapped to the existing generic
`unavailable` state by `OfflinePlaceSearch`; no exception details, local
paths, SQL, or query text are added to the UI.

## Verification

Focused tests: `node --experimental-strip-types --test
tests/offline-place-ipc-snapshot.test.mjs`.
Regression suite: `npm test`.
Build: `npm run build:ui` with the approved sibling Charts library checkout
and synthetic assets prepared.

The tests use a fictional city and cover sparse arrays, accessor-backed
responses, getters not being executed, inherited fields, non-plain records,
omitted country mapping, mutable input isolation and error redaction.
A Windows WebView2 smoke against the licensed offline city pack is still
required; Node tests do not prove that the pack can be legally distributed or
that native IPC works on a physical workstation.

## Boundaries

Only the TypeScript/native IPC **result decoding** changes. There are no Rust
command additions, changes to SQL or the private city catalog, native
permissions, encrypted storage, authentication, real astronomical calculations,
account sync, telemetry, network calls or updates. License and NOTICE remain
unchanged. The selected city remains a temporary UI preview, not a saved
birthplace or proof of precise historical timezone calculation.
