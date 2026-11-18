# Connected account: registered but disabled Tauri IPC (2026-11-18)

This stacked, draft-only slice registers `desktop_connected_account_v1` as a Tauri command and installs exactly one app-owned `NativeLoginRegistry` state object. The command is deliberately an inert, fail-closed **disabled** staging boundary, not a functional login. It never calls the registry's start/status/cancel methods, launches a browser, starts a loopback listener, exchanges a code, stores credentials, or enables cloud sync.

## Exact public surface

- Angular defaults to `enabled: false` and does not invoke native code at all in that mode. Browser preview returns `not_native` only when callers explicitly enable the candidate.
- With an explicit local `enabled: true` and a native Tauri host, the request is `invoke('desktop_connected_account_v1', {request})`.
- Request payloads must have `protocolVersion: 1` and exactly one supported operation: `start` without an attempt ID, or `status`/`cancel` with a lowercase UUIDv4 `attemptId`. Extra keys, wrong types, unsupported versions, and malformed IDs fail closed to `native_unavailable`.
- Every valid request returns exactly `{ "protocolVersion": 1, "status": "disabled" }`; no identifiers, tokens, URLs, codes, state, verifier or backend error details cross to the WebView. Angular now recognizes *only* this exact two-field disabled response; extra keys fail closed.
- The managed Rust registry exists but is not queried or mutated by this command. It has no endpoint or app credentials wired into IPC.

## Gates before live login

1. The old Angular candidate expected `charts:read` and a `deviceId`; the backend candidate returns `chart_sync:read` and no device ID. The v1 connected-status schema and decoders now agree on read-only scope without inventing an ID. This does not prove live interoperability: no real connected state may be reported until server verification is implemented and reviewed.
2. Review allowed staging origins, PKCE/browser/loopback lifecycle, and grant scope. Add a correctly configured staging backend and explicit consent flow; **do not activate** on production by changing a UI flag.
3. Define secure native session ownership, persistence/revocation/refresh policy and a no-secret response before connecting this IPC to the `NativeLoginRegistry` methods.
4. Run `cargo test --manifest-path src-tauri/Cargo.toml --locked`, `cargo check`, Tauri build, and functional Windows 11 native smoke (offline, launch, cancel, expiry, shutdown, no login on normal app start). The current execution environment lacks a Rust/Cargo toolchain, so Rust tests in this slice have not been compiled.

No main-branch merge, no deployment, no GitHub Actions, no release, no production OAuth exposure in this slice.
