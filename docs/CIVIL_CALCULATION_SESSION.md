# Civil-time and latest-only calculation queue integration

**Status: isolated, locally tested TypeScript integration. Not wired to the active Angular UI, native Rust calculation worker, or a verified sky.**

This dedicated integration branch combines the original civil-time draft chain (#52, #56, #60) with the actual LatestCalculationQueue from draft #47 using a two-parent merge commit. The original PR branches and main remain unchanged.

## Implemented behavior

src/app/native/civil-calculation-session.ts exports CivilCalculationSession(sessionId, port, notify). Its submit(input, location, calculationKey, selectedUtc?) method delegates to the real IANA civil-time resolver, explicit DST choice helper, civil calculation dispatcher, and bounded latest-only queue.

- Invalid dates, missing local times, DST gaps, ambiguous hours without an explicit UTC selection, invalid WGS84 coordinates and invalid request keys never reach the provider port.
- Every new submission invalidates previous work, including when the new input cannot be calculated. The UI must also call invalidate() on **every edit**, not only after pressing submit.
- The queue permits at most one active request and one latest pending request. It drops obsolete replies, even if a test provider ignores AbortSignal.
- The injected provider is intentionally not instantiated here. A fake/unavailable provider can be used for local integration tests without DE441 or Tauri.
- **All ready replies are denied** by a fail-closed snapshot validator. This remains true even for a reply that claims scientific validation. The only possible consumer outcomes are unavailable, unsupported, invalid_reply or transport_error. This is a scientific quarantine, not an astronomical solver.
- dispose() invalidates outstanding work and prevents later submissions. Aborting an already running Rust computation is not guaranteed.
- No user birth records, kernel data or account tokens are persisted or logged. The caller must design a non-PII session-scoped calculation identity covering all calculation-changing parameters; key syntax validation alone cannot establish that property.

## Local execution results

With Node.js 22.16.0 and TypeScript 5.8.3:

    node --experimental-strip-types --test tests/civil-calculation-session.test.mjs tests/civil-calculation-dispatch.test.mjs tests/civil-time-choice.test.mjs

**35/35 passed:** 12 new cases exercising the real queue and 23 existing civil-selection/dispatch cases. The new tests cover Rome DST fold choices, nonexistent hours, racing form edits, running provider cancellation, 200 rapid submissions, one-latest-pending behavior, forged ready payload quarantine, correlation mismatch, error recovery, disposal and bad input rejection.

    tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/native/calculation-queue.ts src/app/native/civil-time.ts src/app/native/civil-time-choice.ts src/app/native/civil-calculation-dispatch.ts src/app/native/civil-calculation-session.ts

**Passed** with the exact combined TypeScript sources. The test-only module loader in tests/ts-relative-resolution-loader.mjs uses node:module.register() to resolve Angular's existing extensionless TypeScript imports in Node's isolated test process. It does not alter production imports or install dependencies.

## Remaining gates

1. Review and validate the stacked PRs in dependency order (#47 and #52, then #56 and #60, then this integration). Run the full repository test suite and Angular build in the combined checkout.
2. Implement the birth-time form and accessible two-choice DST UI, and invalidate immediately after input edits.
3. Design a non-PII stable calculation fingerprint that covers all scientific inputs; verify time-zone database provenance and account isolation.
4. Validate real Rust/Tauri IPC, scientific DE441 kernel provenance, provider date support and numerical accuracy with independent JPL/NAIF references. The DE441 experimental validity window is narrower than the civil-time helper's accepted years.
5. Only after independent review replace the deny-all ready validator with a strictly versioned scientifically validated snapshot contract. Do not bypass the experimental-readiness quarantine of PR #51.

**Not executed:** full npm test across the whole repository, Angular UI compile, Cargo/Rust, external DE441 file calculations, JPL reference tests, real Windows WebView2 or production installation. No GitHub Actions, merge to main, external data, deployment, release or publication.
