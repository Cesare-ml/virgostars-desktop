# Native IPC response snapshot safety (v1)

**Status:** Locally tested source hardening on a review branch; this is not Windows/WebView2 acceptance or an authentication/astronomy feature.

The read-only `desktop_runtime_info` Tauri response is untrusted at the JavaScript boundary. The decoder previously validated `platform` and `applicationVersion` by reading from the original reply, and then read the same fields again when constructing the UI payload. A dynamic accessor or mutable transport wrapper could return a different value on the subsequent read. Normal Tauri JSON deserialization should yield ordinary data properties; nevertheless, the boundary must not depend on that assumption.

The decoder now reads each of the eight approved v1 fields **exactly once**, validates those snapshots, bounds the version string to 64 characters, and returns a detached, frozen object containing only the contract's approved fields. Accessor errors are normalized to one public error message. The caller's existing `probeDesktopRuntime` catches such errors and returns `native_unavailable` without surfacing local details or claiming account, cloud-sync or ephemeris readiness.

## Reproducible local check

```sh
node --experimental-strip-types --test tests/native-runtime-snapshot.test.mjs
```

Six synthetic regression cases cover single-read behavior, changing/throwing accessors, invalid-first-read rejection, oversized version strings, frozen output and rejection by the asynchronous probe.

This is a dependency-free TypeScript validation change. No Rust command, IPC permission, frontend chart renderer, storage, account, network endpoint, personal data, third-party asset, CPAL attribution, build scripts, GitHub Actions or production service is modified.

## Pending gates

Run repository-wide `npm test`, strict TypeScript/Angular build, and native Windows WebView2 IPC smoke before any release candidate. Test interoperability with the stacked Windows UI PR #112 and confirm its own integration uses the latest safe decoder. The original runtime command still returns **synthetic_demo** with all unimplemented capabilities disabled.

## Fail-closed deadline setup (2026-11-13)

The native runtime probe also guards its **timer setup before invoking** the read-only Tauri command. Previously the optional timer-provider getter ran outside the probe's `try` block: a throwing accessor could reject the returned promise with raw internal details. A broken test/host timer adapter could also return `null` or `undefined` without supplying a cancellation handle, while the probe proceeded to dispatch native IPC.

The timer provider is now resolved *after* native detection, inside the error boundary; its accessor errors produce only `native_unavailable`. Nullish timer handles are rejected **before** dispatch. The numeric handle `0` remains valid for browsers/test doubles and is cleared after a successful invocation. An explicit `null` options argument uses the default bounded timer. Browsers never inspect timer configuration.

These guards do not prove a malicious scheduler actually calls its callback on time: they enforce the narrow, testable contract that native dispatch requires a successfully returned non-null timer handle. They introduce no retries, background polling or new native permissions.

### Executed regression evidence

Node.js 22.16.0, with exact source/test Git blob parity:

```sh
node --experimental-strip-types --test tests/native-runtime-snapshot.test.mjs tests/native-runtime-timer-guards.test.mjs
tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/native/runtime-protocol.ts
```

**11/11 Node tests passed**, zero failed/skipped (six snapshot tests and five deadline tests); strict standalone TypeScript compilation passed. Four of the five new tests failed against the previous source and passed after the guard fix. This was an isolated module-level test run, not the repository-wide npm, Angular, Rust, Tauri or Windows WebView2 acceptance suite.
