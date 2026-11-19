# Rust-only PKCE attempt and loopback callback core

**Status: Implemented source candidate, not compiled/tested on this Linux session.** Date: 2026-11-18. Stacked on Desktop draft PR #353. Upstream VirgoStars website/backend authorization and consent remain disabled.

## Implemented in the isolated Rust module

- Native 32-byte cryptographic randomness (`getrandom`) for each PKCE code verifier and OAuth state; base64url, no padding (43 characters), never exposed through IPC.
- `S256 = BASE64URL(SHA256(ASCII(code_verifier)))`, using RustCrypto `sha2` and the standard RFC 7636 Appendix B known vector.
- Random version 4 UUID attempt ID safe for presentation, generated separately from secret state and verifier.
- Mandatory **already bound** IPv4 loopback port, 1024–65535, redirect `http://127.0.0.1:<port>/virgostars/oauth/callback`. The socket/listener is **not** implemented by this PR.
- Strict allowlisted HTTPS VirgoStars consent page, query parameters matching web preview parser. No alternative host, redirect path, fragment, query or WebView password prompt.
- Ten-minute `Instant` deadline and one-time state validation for a local redirect, rejecting duplicate, unexpected, re-encoded or malformed query parameters, wrong path/port/host/scheme, replay and late callback.
- Matching `access_denied` yields a distinct denial. Approved one-time authorization code and PKCE verifier remain `Zeroizing` Rust values, for a future native-only HTTPS token exchanger; secrets are never serialized to Angular.
- No `tauri::command` or `invoke_handler` registration, no user-visible active feature or OS credential changes.

## Ownership and security boundary

The future listener must bind `TcpListener` **exclusively to `127.0.0.1:0` before creating the attempt**, take the actual local port and enforce bounded header size, connection deadline, `GET` method, loopback peer and Host header validation. Do not trust a query URL supplied by JavaScript. Close the listener after the first *validated* result, cancellation or expiry. Never log callback paths/query strings or authorization codes.

The future host must open the system browser itself, perform server token exchange over verified TLS, validate issuer and audience and store credentials in the OS vault; only then may it return a `connected` result through the Desktop contract. Revoke/refresh and account isolation require independent work. The website needs verified session-bound consent, CSRF, Origin and rate limit integration before it can be used with real accounts. Current website/backend PRs #363–#367 are staging-only candidates.

## Local verification and remaining gates

Written Rust unit tests cover random values, RFC 7636 known S256 output, exact consent request, strict port/host/path, callback query abuse, expiry, denial, cancellation and replay. **They have not been run**: `cargo`/`rustc` are not installed in the execution environment. Before accepting the PR, on Windows with the actual Desktop checkout run:

```powershell
cd D:\GitHub\virgostars-desktop
cargo test --manifest-path src-tauri/Cargo.toml pkce_login
cargo check --manifest-path src-tauri/Cargo.toml --locked
npm test
```

After dependencies are resolved, run a real Windows integration test for listener/browser, certificate verification, secure token storage and server-device revocation. Avoid GitHub Actions, AWS production changes, automatic merge or release.
