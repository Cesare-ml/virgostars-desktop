# Native runtime bridge 001 — read-only Tauri protocol

**Status (2026-11-10):** TypeScript implementation and Rust source committed in a stacked **draft PR**. The actual Rust/Windows build and WebView2 IPC round-trip **have not been executed** in the authoring environment (Rust MSVC unavailable, npm registry inaccessible).

## Purpose

This is the smallest possible bridge between the Angular workstation UI and the Tauri 2 Rust host. A versioned, read-only command named `desktop_runtime_info` returns local build/runtime metadata and truthful feature flags. It is a **development capability probe** and not an authentication API, ephemeris computation, account synchronization or a network health check.

## Contract v1

A sample payload on Windows, while running version 0.0.1:

```json
{
  "protocolVersion": 1,
  "product": "VirgoStars Desktop",
  "applicationVersion": "0.0.1",
  "platform": "windows",
  "fixtureKind": "synthetic_demo",
  "accountConnected": false,
  "cloudSyncAvailable": false,
  "ephemerisReady": false
}
```

On macOS/Linux, `platform` is respectively `macos` or `linux`; the application version is derived from Rust's Cargo package version. All booleans are deliberately false. This is **not** a claim of validated cross-platform builds.

- Rust: `src-tauri/src/runtime_probe.rs`, registered through `tauri::generate_handler![...]` in `src-tauri/src/lib.rs`.
- TypeScript: `src/app/native/runtime-protocol.ts` validates untrusted IPC responses and exposes a testable transport.
- Tauri adapter: `src/app/native/runtime.ts` imports `invoke` and `isTauri` from `@tauri-apps/api/core` (version pinned to 2.12.2 to match the existing Tauri CLI).
- Angular: the footer explicitly displays one of **checking**, **native synthetic demo**, **browser preview**, or **native unavailable**; English and Italian labels exist.
- Browser-only development does not attempt native invocation. Any invalid or failing native response is reported as unavailable, rather than fabricating a successful connection or leaking exceptions.

## Security boundaries

The command accepts **no arguments** and performs no filesystem I/O, network access, command execution or cloud calls. No permissions are extended to arbitrary Tauri plugins. No global `window.__TAURI__` bridge is enabled.

The TypeScript validator accepts only protocol version 1 with the expected product, format, synthetic fixture marker and truthful disabled capabilities. Additional unknown keys in input are **not propagated** to the UI. Version mismatches fail closed.

Tauri command registration is not account authorization. When authentication and sync are added, use separate, scoped permissions, per-user data boundaries and threat modeling; do not reuse this development handshake as a session token.

## Tests and verification

- `tests/native-runtime.test.mjs`: **9/9 passed locally on Node.js 22.16.0**, including schema validation, browser no-call, native command invocation, malformed response, exception isolation and future platform labels. The local protocol implementation's Git blob SHA matches the GitHub source.
- `tests/native-runtime-source.test.mjs`: four source contract checks for Rust command registration/feature flags, API imports and explicit UI disclosure (**written; not yet run against a complete checkout**).
- Rust: `cargo test` unit tests in `src-tauri/src/runtime_probe.rs` verify false capability flags and JSON camelCase serialization. **Not executed yet.**
- Keep running all existing synthetic-asset tests; do not interpret them as full application or scientific correctness verification.

### Next Windows acceptance gate

From an authorized Windows development checkout (see `SHELL-001.md` and `ASSET_PIPELINE.md`), install the Rust MSVC toolchain and Node dependencies, then:

```powershell
npm test
npm run build:ui
npm run prepare:icon
cd src-tauri
cargo test
cd ..
npm run tauri:dev
```

A clean WebView2 instance should show the native demo indicator; `npm start` in a normal browser should show the browser preview indicator. Test the native error path and confirm there are no HTTPS requests for runtime probing.

Before declaring this milestone integrated: record a compiled Windows binary and test it with the network disconnected, verify Tauri command names and source map policy, review generated `Cargo.lock` and `package-lock.json`, and ensure actual chart render/export still works.

## Future separation

The verified `platform` and protocol version can later help gate update packages, local SQLite, and native ephemeris bindings. This command is **not** a substitute for any of those implementations.

No GitHub Actions, merge, release, deployment or change to VirgoStars production services is part of this increment. Repository is still private and the eventual open-source license remains undecided.

## Planetary hour: separate read-only solar-event port (2026-11-18, draft)

The earlier `desktop_runtime_info` protocol stays unchanged. A separate
`calculate_solar_events` Tauri command now accepts the already reviewed
`ChartRequestV1` instant and observer coordinates. Its response is v1:
`{protocolVersion, status, snapshot}`. Failure statuses contain `snapshot:null`;
`ok` contains observer (including elevation), explicit horizon/refraction/model
IDs, engine/kernel/time-model descriptors and a discriminated event window:
`AVAILABLE` carries preceding sunrise UTC, intervening sunset UTC and following
sunrise UTC; `UNAVAILABLE` states a polar or missing-event reason. The snapshot
deliberately has **no weekday**: Angular derives the sunrise-local weekday from
the chart's IANA time zone before the existing domain hour calculation.

The Rust `SolarEventsProvider` trait is a dependency-injected, read-only port,
with coverage and error cases exercised by synthetic Rust test fixtures.
**No producer is registered in the actual application**: the pinned Ephemeris
core does not provide a reviewed solar-event API, so valid native requests
currently yield `provider_unavailable` without astronomical data. The default
port must not be changed to a calendar approximation or an unreviewed core
commit. `src/app/native/solar-events-contract.ts` strictly copies the response,
rejects unexpected fields and mismatched natal observers, delegates domain
calculation to `astrological-functions`, times out after 5 seconds and ignores
late responses on theme change via the Angular controller.

The native IPC source audit now pins **six** read-only commands/adapters.
Node tests and the Angular offline build cover synthetic contracts, not real
solar events. Rust unit tests, actual WebView2 IPC, sample DE441 comparisons,
polar-edge numerical behavior and independent scientific benchmarks remain
Windows/upstream acceptance gates; do not present this draft as a working
automatic planetary-hour calculator or merge it without maintainer review.

## Bounded native capability handshake (2026-11-13, draft)

The Angular runtime label must not remain on "checking" forever if the
local Tauri IPC command hangs. The `probeDesktopRuntime` adapter now applies a
**4,000 ms default deadline** only to the read-only `desktop_runtime_info`
native invocation. A successful v1 reply still produces `desktop_demo`.
A timeout, malformed response, rejected native invocation, invalid configured
deadline or timer setup failure produces `native_unavailable` with no raw
exception details. Browser previews skip both the IPC command and timer.

The deadline is cleared when the probe settles. A late native reply after
timeout is ignored by the settled promise; this does **not** cancel an operation
inside Tauri. The call is strictly read-only and local, so no retry or
background polling is introduced. The default is fixed at 4 seconds for the
application; tests can inject deterministic timers and a positive integral
timeout up to 30 seconds. This is not an authentication, login, cloud-sync or
ephemeris readiness signal.

Run `node --experimental-strip-types --test tests/native-runtime.test.mjs`
and the full `npm test` suite in the authorized desktop checkout. Synthetic
tests cover never-settling IPC, cleanup, late replies, invalid timeouts, and
the browser-preview bypass. Windows WebView2 UI and production builds still
require a separate real-machine acceptance test; a synthetic timeout test
does not prove native stability, operating-system integration, or astronomical
accuracy. No sensitive paths, credentials, production users or cloud calls
are involved.

## Timer registration order and fail-closed dispatch (2026-11-13)

The read-only native capability probe must **register a usable timeout before it dispatches** `desktop_runtime_info`. Previously, the implementation created an invocation microtask before attempting timer registration. If a scheduler threw, the UI correctly reported `native_unavailable`, but the queued IPC microtask could still run without a deadline. Simply moving `new Promise((resolve,reject) => timers.set(...))` before the invocation was **insufficient**, because an exception inside a Promise executor becomes a rejected Promise rather than a synchronous throw.

The implementation now creates a pending deadline promise, installs a rejection observer for partially registered/throwing timer implementations, and calls `timers.set` **outside the Promise constructor**. Only after a handle has been returned and the timer has not fired synchronously does it queue the read-only invocation. A scheduler that throws (even after running its callback) or fires the callback synchronously produces `native_unavailable` with **zero native invocations**. Registered timer handles are cleared on exit, and detailed exception messages remain redacted.

### Verification performed

- Node.js **22.16.0** actual test runner: `node --experimental-strip-types --test tests/native-runtime.test.mjs` — **18/18 passing**, zero failed/skipped, including the three scheduler/IPC ordering regressions.
- TypeScript **5.8.3** strict standalone compilation: `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/native/runtime-protocol.ts` — **passed**.
- Executed local sources and tests are byte-identical to committed GitHub objects: `src/app/native/runtime-protocol.ts` SHA `ba933e01f69b678898c85427c1ba11aceadb296c`; `tests/native-runtime.test.mjs` SHA `a99509bbd409e411121ee5dae1c997487ee8c7fe`.
- This is a local deterministic protocol test, **not** a complete application `npm test`, Angular/Charts build, Cargo/Tauri or Windows WebView2 acceptance. No account login, astronomical calculation, native permission or production service was changed.

This patch is an independent reviewable draft on `main`; it does **not** merge `main`, authorize a release or retroactively validate the large stacked UI PRs. On Windows, explicitly test a missing native IPC reply, timeout, normal reply and startup/shutdown with the network disconnected.
