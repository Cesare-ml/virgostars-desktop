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
