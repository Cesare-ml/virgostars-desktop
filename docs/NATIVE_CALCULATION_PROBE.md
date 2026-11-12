# D-02 — Native calculation probe (protocol v1)

**Status: TypeScript adapter locally tested; Rust source committed for native compilation; no real astronomical solver linked.**

This is the next strictly bounded step after [D-01 latest-only queue](LATEST_ONLY_CALCULATION_QUEUE.md). It does **not** activate live charts and must not be mistaken for integrated VirgoStars-Ephemeris.

## New command and transport

- Rust Tauri command: `desktop_calculation_probe` in `src-tauri/src/calculation_probe.rs`.
- Frontend injection port: `src/app/native/calculation-port.ts`; opt-in Tauri adapter: `src/app/native/calculation-probe.ts`.
- Payload is a single `request` object matching the v1 queue envelope: `protocolVersion`, `sessionId`, `requestSeq`, `intent`, `utcIso`, `latMicro`, `lngMicro`, `timeZone`, and `calculationKey`.
- Request fields are checked **both in TypeScript and Rust**. Rust independently checks UTC Gregorian calendar dates, second range (not leap-second labels), numeric bounds, identifier length/content, and basic timezone-string syntax. It does **not** confirm IANA historical timezone rules or convert UTC to TT/TDB. The caller validates timezone IDs with `Intl`; a future Rust provider must separately validate location/timezone provenance against an approved bundled time-zone database.
- The only accepted native response is `{protocolVersion:1, sessionId, requestSeq, calculationKey, status:'unavailable', reasonCode:'EPHEMERIS_NOT_INTEGRATED'}`. There is **no** `snapshot`, `providerVersion`, planetary longitude, invented synthetic sky, or silent lower-precision fallback.
- Existing `desktop_runtime_info` is unchanged and continues to report `ephemerisReady=false`; it is not re-purposed as an astronomy command.

The frontend adapter uses the official `@tauri-apps/api/core` transport only, with no HTTP. It refuses to call native IPC outside Tauri, checks aborts before/after the call, projects exactly nine allowlisted fields, and delegates the reply correlation and error sanitization to the D-01 queue. AbortSignal is **not** native CPU cancellation: late native replies are discarded by the latest-only queue.

## Native worker backpressure

The Rust command uses a managed `CalculationProbeGate` with an atomic single active permit. Extra concurrent calls return `CALC_WORKER_BUSY` rather than accumulating work. The permit is RAII-owned by a `tauri::async_runtime::spawn_blocking` task and returned on completion or unwinding. The task currently performs only constant-time production of the explicit `unavailable` status, **not scientific computation**. For real ephemerides, add bounded job scheduling, cooperative native cancellation, memory and timeout limits after measuring kernel access.

The command has no filesystem access, kernel path arguments, database reads, network access, credentials, logging of personal data or privileged backend permissions. This is a guest/offline-only developmental IPC handshake. No extra dependencies, license or asset files were introduced.

## Tests

**Actually run locally (Node.js v22.16.0):**

```sh
node --experimental-strip-types --test tests/latest-calculation-queue.test.mjs tests/native-calculation-port.test.mjs tests/native-calculation-wiring.test.mjs
# 16 passed, 0 failed (7 D-01 + 6 adapter + 3 source wiring)
tsc --noEmit --strict --target ES2022 --module ES2022 --moduleResolution bundler --lib ES2022,DOM src/app/native/calculation-port.ts src/app/native/calculation-queue.ts
# passed
```

The Rust module includes five unit tests for Gregorian/date validation, protocol and input bounds including `i32::MIN`, unknown-field rejection, single-slot gate, and absence of astronomical output. **These Rust tests were written but not executed here because Cargo/rustc are unavailable.** The Node source-wiring tests are not a Rust compile or an IPC integration test.

**Required on Windows before review/merge:** run `npm.cmd test`, `npm.cmd run build:ui`, then `cd src-tauri; cargo fmt --check; cargo test; cargo clippy --all-targets -- -D warnings` with the approved toolchain. Launch Tauri disconnected from the Internet and manually invoke the command using the synthetic request in this document. Verify valid input returns the explicit unavailable status; invalid input and incompatible protocols fail with a sanitized code; bursts never create an unbounded number of Rust worker tasks. Test WebView2 and a closed/reopened window. Do not claim any real ephemeris accuracy.

## Integration and next gate

This PR is stacked on **draft #47** and must not be merged ahead of it. UI drafts #45/#46 and storage/city search PRs remain independent; reconcile when integrating.

For actual astronomical positions, first confirm the public `VirgoStars-Ephemeris` Rust crate API and independent JPL/NAIF numerical comparison, pin a compatible local kernel with redistribution review, define typed quality/provenance/range/unit and supported bodies, and then replace the unavailable worker with a genuine bounded provider on a **new reviewed PR**. Only after that may `astrological-functions` and `astrological-charts` receive real snapshots; never bypass scientific validation.

No GitHub Actions, merge, release, production changes, database migrations, publication or license changes are performed in this slice.
