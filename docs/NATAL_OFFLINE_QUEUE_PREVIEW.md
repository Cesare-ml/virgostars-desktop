# Natal preview → latest-only queue integration (unavailable-only)

**Status: locally tested source-only integration; NOT connected to the Angular UI, Rust, Tauri IPC, storage, account or real astronomy.**

This draft integrates the *exact original source and tests* of the bounded `LatestCalculationQueue` from #47 with the provisional natal UTC candidate contract from #88. The queue files are brought in with their original Git blobs through a two-parent merge commit, preserving both draft branches; main remains unchanged.

The new `NatalOfflineQueuePreview` has **no injected calculation provider**. Its constructor always installs a local synthetic-only port returning a correctly correlated `unavailable` status, and a `SnapshotValidator<never>` that denies every `ready` snapshot. This is intentionally incapable of reaching Rust, Tauri, HTTP or a real ephemeris. It is not a saved natal chart, and does not modify the synthetic Three.js chart.

## Submission path

1. The caller supplies the current natal draft, its preview anchor, advisory timezone result, explicit UTC selection (when ambiguous), and a provider-declared date range.
2. **Immediately invalidate** any previous queue work, including when the new draft is invalid. Input editing should additionally call `invalidate()` as soon as the user changes it.
3. Run `prepareProvisionalNatalCandidate` with the existing `isNatalPreviewCurrent` guard from #88. Unknown birth hours, stale values, mismatched IANA zone, unresolved DST folds, unsupported dates/coverage and malformed data never reach the queue.
4. The provisional UTC instant and microdegree coordinates are passed to the original `LatestCalculationQueue` using `intent: 'preview'` and a bounded `natal_preview_N` correlation value. This is **not a stable scientific fingerprint**; it is safe only because the adapter's port is a hard-coded unavailable-only mock.
5. The existing latest-only queue coalesces rapid changes, drops abandoned replies and suppresses notifications after disposal. The callback exposes only `{kind:'unavailable'}` (or sanitized queue failures), never request metadata, birth date, name or city.
6. `dispose()` permanently closes the queue.

**Scientific readiness remains blocked.** A real future native adapter needs reviewed UTC/timezone provenance, independent source coverage and DE441/JPL validation, stable privacy-safe calculation fingerprints, and the deny-all quarantine in #51/#61. It must be a separate PR; changing the mock port to a real one is not authorized by this integration test.

## Test execution

On Node v22.16.0 and TypeScript 5.8.3, from a scratch directory with the exact new adapter, exactly matching #47 queue source (Git SHA `8bbfebd4e17ce7d91dfcae35b428e9df028c4369`), and the #88 candidate helper:

- `node --experimental-strip-types --test tests/natal-calculation-candidate.test.mjs tests/natal-offline-queue-preview.test.mjs`: **28/28 PASS** (17 existing candidate tests and 11 new real-queue integration tests).
- Strict `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM` on the candidate, queue and adapter plus supporting local type-only mocks: **PASS**.
- Exact local Git hashes matched GitHub's newly created tree: adapter `aaaa5bafa5d245fab969f00074ac1ffd6343eadc`, tests `39bd20974d18fe2de0b6b730edf1ec0347d7b2cc`, queue `8bbfebd4e17ce7d91dfcae35b428e9df028c4369`, test loader `81ecc1231fbd070f4a1221fce1248a05a69e2b7b`.
- Integration tests use a **type-compatible fictional natal-state fixture** and reproduce the existing freshness guard's behavior; they do not instantiate the full Angular natal state component. The actual unchanged queue and candidate helper are exercised, not reimplemented.

**Not run:** complete `npm test`, full Angular template build, macOS/Windows WebView2 acceptance, Rust cargo tests, native IPC, actual historical tzdb quality review, kernel data scientific validation or end-to-end birth chart.

## Dependencies and merge review

Base #88 depends on #81 → #77 → #74 → #64 → #63. The second parent #47 brings in the original queue source and tests. #79/#85 and the alternative UI #62 remain separate and must be reviewed explicitly. Review the two-parent merge tree and avoid merging duplicate queue implementations independently. Do not merge to main without complete validation and explicit approval.

No new dependencies, automated GitHub Actions, deployment, production, secrets, actual birth records, persistence, user-facing charts or repository visibility change.
