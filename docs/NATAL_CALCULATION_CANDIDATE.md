# Natal form to provisional calculation candidate

**Status: locally tested TypeScript prerequisite, not an active calculation.**

This additive draft uses the existing natal editor from PRs #63, #64, #74, #77 and #81. It does NOT introduce a second form, modify the UI, activate native IPC, or produce astronomical coordinates. The future scientific calculation queue from #61 and quarantined DE441 native experiments from #48/#51 are separate draft lines.

## Scope and safety

The new TypeScript helper prepares an explicitly PROVISIONAL input after checking a source natal preview and its freshness guard, optional selected UTC candidate, bounded WGS84 coordinates already validated by the existing form, and a declarative future provider coverage interval.

The helper rejects:
- Modified or retired natal preview and changed city/location
- Unknown birth time (never assumes noon, midnight or house angles)
- Civil year outside 1900–2100, the narrower date range of the separate #52/#61 civil-time pipeline
- Missing or mismatching IANA timezone data, nonexistent local time, missing timezone database version
- DST repeated hour without the exact explicitly selected UTC instant
- Malformed, duplicated, unsorted, inconsistent or forged UTC candidate timestamps and offsets
- Missing, reversed, malformed or out-of-range declared provider coverage

On success the status is strictly PROVISIONAL_ONLY, NOT ready. The projected payload contains only canonical UTC, WGS84 microdegree coordinates, IANA timezone, offset seconds, bundled timezone data version/caution, explicit UNVERIFIED provenance and declared provider ID. Name, place ID/name, country/region, contact data, original birth text and all account fields are excluded.

A caller-declared provider range does not validate kernel dates or independent astronomical data. The Rust provider must separately verify the UTC conversion, true supported dates, time scales, JPL/NAIF DE441 kernel provenance and numeric accuracy before any astronomical work; the #51 experimental quarantine and the #61 deny-all ready validator must remain in force until that is approved.

## Checks actually executed

Local environment: Node.js 22.16.0, TypeScript 5.8.3.

- Node test command: node --experimental-strip-types --test tests/natal-calculation-candidate.test.mjs
- Result: **17 / 17 PASS** with fictional person/place data and a behaviorally equivalent copied preview-freshness guard.
- TypeScript strict: tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/natal-calculation-candidate.ts
- Result: **PASS**, with local type-compatible stubs for existing natal and timezone interfaces.

The exact helper and test sources were verified by matching local Git blob SHA-1 values to newly created GitHub tree blobs. The documentation and implementation contain no credentials, private personal records or kernel data.

NOT run: full npm test, full Angular template compilation, Windows Tauri/WebView2, real runtime moment-timezone pack, native Rust IPC, full ephemeris numerical validation, real user data or release process.

## Integration gates

After review, choose the complete #63 natal editor rather than merging both competing forms (#62 and #63). Integrate parallel correction PR #79 explicitly. Re-run the full repository test suite and Windows GUI smoke in a combined branch before enabling any IPC or saved charts. This helper intentionally cannot send a calculation on its own.

No GitHub Actions, release, main merge, production changes, backend operations, public visibility change or new dependencies.
