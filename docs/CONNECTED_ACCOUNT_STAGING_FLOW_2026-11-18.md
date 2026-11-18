# VirgoStars Desktop · bounded staging login worker flow

**Status: native-only, uncompiled candidate; no real online login.** Stacked on the separate token-contract draft PR #358 and prior Desktop PKCE drafts. All fixtures are synthetic.

## Integrated Rust lifecycle candidate

`StagingLoginAttempt::begin(browser, consent_url, token_endpoint)` validates the staging token destination *before* binding a loopback listener or dispatching the browser. The verified listener binds `127.0.0.1` first, creates state and PKCE challenge, and invokes the injected `SystemBrowserOpener`. Only the opaque attempt ID and `LoginCancelHandle` are exposed to the future host session manager; neither exposes a token, verifier, code, browser URL or raw callback.

A future **dedicated Rust worker**, not the UI thread, calls `wait_and_exchange(transport, max_wait)`. It accepts at most the already bounded callback and passes the code/verifier to the separate native `TokenHttpTransport` exchange contract, using the precise redirect URI from the bound listener. On success it returns a zeroizing, non-serializable, short-lived `NativeAccessGrant` to the Rust host only.

## Cancellation and failure isolation

- The cancellation handle uses `Arc<AtomicU8>` with atomic states **active / cancelled / completed**, and can be signalled from another native thread without access to the listener or secrets. The listener checks cancellation during its 20 ms poll loop, before accepting an inbound callback, and again before returning a validated callback. A blocking read is limited to 350 ms, so cancellation is **bounded, not synchronous**.
- The orchestrator checks cancellation before waiting and after receiving the callback. On a successful exchange, an atomic compare-and-swap determines whether cancellation or completion won: when cancellation wins, the token is dropped and zeroized; when completion wins, later cancellation cannot retroactively withdraw the result. Cancellation during an external network request may not abort the underlying request: the future HTTPS client must support its own cancellation/deadline and must not automatically retry a one-use code.
- Invalid staging endpoints fail before the browser is launched. A token exchange failure does not retry the code and cannot produce an authenticated UI state. The generic errors do not include URLs, codes, verifiers or server bodies.

This is intentionally not a Tauri command, account UI, configured HTTPS adapter, connected staging backend or backend deployment. It cannot authenticate a live user yet. In particular the backend's short-lived token still has no refresh mechanism; persistent login and offline device recovery remain separately blocked.

## Synthetic tests and later Windows checks

The Rust unit tests simulate a browser receiving the consent URL, making a literal loopback HTTP GET, receiving the browser callback response and returning a fake backend token response. Separate tests cover cancellation while waiting, cancellation before exchange and fail-closed destination validation. No external site, account or credential is accessed.

Node source-contract gate:

```sh
node --test tests/pkce-loopback-boundary.test.mjs tests/pkce-os-browser-boundary.test.mjs tests/pkce-native-token-exchange-boundary.test.mjs tests/pkce-staging-flow-boundary.test.mjs
```

On the maintainer's Windows 11 checkout, with the stacked PRs checked out:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml pkce_staging_flow::tests --locked
cargo test --manifest-path src-tauri/Cargo.toml pkce_loopback::tests --locked
cargo test --manifest-path src-tauri/Cargo.toml pkce_token_exchange::tests --locked
cargo check --manifest-path src-tauri/Cargo.toml --locked
```

Those Rust commands have **not** run in this authoring environment (no Rust/Cargo). Future work: real TLS transport with redirect refusal, refresh-token design in a separately authorized backend task, a single native account-session worker with scoped Tauri IPC/status/cancel, and complete Windows staging identity/CSRF/device-grant E2E before any production release.
