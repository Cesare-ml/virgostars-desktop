# D-03 — Scientific readiness quarantine for native calculation previews

**Status:** tested pure TypeScript safety adapter, stacked on draft PR #48. Not an astronomical integration, production feature, or scientific certification.

## Failure prevented

The receive-only guardExperimentalSkyPort in PR #48 can accept a strictly shaped ready reply containing a DE441 geometric snapshot that explicitly declares scientificStatus: experimental_unverified. Shape validation alone cannot certify JPL/Horizons numerical parity or make geometric mean-of-date positions suitable for an apparent astrological chart. A future caller that supplied a permissive snapshot validator to the latest-only queue could otherwise emit a misleading ready state.

## Increment

- src/app/native/scientific-readiness-gate.ts exports quarantineUnverifiedSkyPort: a receive-only, injected, fail-closed wrapper. Every ready message is stripped of its snapshot and correlated with the original request, never passed through as calculated sky.
- Well-formed experimental previews (already checked by the upstream guardExperimentalSkyPort) become unsupported with reason EXPERIMENTAL_SKY_NOT_VALIDATED. Unknown or deceptive ready replies become invalid_snapshot, which the v1 queue maps to invalid_reply.
- Existing unavailable and unsupported statuses pass unchanged. Aborted late replies reject. This adds no astronomic calculations, file paths, credentials, network, local data storage, or native permissions.
- src/app/native/calculation-probe.ts composes the gate outside the existing strict experimental shape guard, preserving all previous request and IPC bounds. No chart UI is connected to this opt-in port.

This is intentionally a temporary deny-ready integration barrier. It does not offer a toggle, staging bypass, or verified flag a client can assert. A future release must supply a separately reviewed scientifically validated Rust adapter, time/frame corrections, kernel provenance, reference fixtures and a strict production snapshot validator before this barrier may be removed or replaced.

## Actual local checks

Executed using Node.js 22.16.0:

    node --experimental-strip-types --test tests/scientific-readiness-gate.test.mjs tests/scientific-readiness-wiring.test.mjs
    # 7 passed, 0 failed

The standalone TypeScript gate also passed tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM with an isolated synthetic type-only stub matching the imported CalculationPort/CalculationRequestV1 surface. This is not a full workspace type check.

**Not run:** full npm test, actual Angular build, Cargo/rustfmt/Clippy, native Windows WebView2 IPC, independent numerical astronomy validation, whole stacked branch with current upstream packages. The imported native module requires the existing #47 and #48 files.

## Acceptance and dependency

This PR must remain stacked on draft PR #48, which itself depends on draft #47. Run the full tests and build on the actual combined checkout before any integration. Windows acceptance must confirm the native command returns explicit unavailable and that a deliberately unverified ready-shaped staging reply cannot enter chart state. The real ephemeris provider remains separate future work.

No GitHub Actions, main merge, release, deployment, license or visibility change; no production accounts or data.
