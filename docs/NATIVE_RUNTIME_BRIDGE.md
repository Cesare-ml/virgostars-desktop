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

- `tests/native-runtime.test.mjs`: nine Node.js tests for schema validation, browser no-call, native command invocation, malformed response, exception isolation and future platform labels.
- `tests/native-runtime-source.test.mjs`: four source contract checks for Rust command registration/feature flags, API imports and explicit UI disclosure.
- Rust: `cargo test` unit tests in `src-tauri/src/runtime_probe.rs` verify false capability flags and JSON camelCase serialization. **Not executed yet.**
- Keep running all existing synthetic-asset tests; do not interpret them as full application or scientific correctness verification.

### Next Windows acceptance gate

From an authorized Windows development checkout (see `SHELL-001.md` and `ASSET_PIPELINE.md`), install the Rust MSVC toolchain and Node dependencies, then:

```powershell
npm test
npm run build:ui
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
