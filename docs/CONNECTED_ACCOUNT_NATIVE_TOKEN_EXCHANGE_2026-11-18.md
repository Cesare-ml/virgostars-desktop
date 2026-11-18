# VirgoStars Desktop · staged native OAuth code exchange candidate

Status: **isolated Rust prototype; not a connected login and not compiled here**. Stacks on draft Desktop PR #357. No account is enabled, no staging backend is deployed, and no credential is persisted.

## Exact backend contract verified against the staging candidate

`POST https://<approved-staging-host>/chart-sync/v1/token` accepts an `application/x-www-form-urlencoded` body with exactly `grant_type=authorization_code`, `client_id=virgostars-desktop`, the previously bound loopback `redirect_uri`, a single-use authorization `code`, and the original PKCE `code_verifier`. The stage-only HTTP implementation in VirgoStars backend draft PR #373 (stacked on #371) returns JSON containing exactly `token_type`, `access_token`, `expires_in` and `scope`, with a maximum **15-minute access token**.

**Important current limitation:** The backend does **not** implement refresh token issuance or rotation. The Desktop must not claim persistent online login or silently retain an expired token. A separately reviewed backend refresh/revocation design is necessary for real returning-device sessions. This PR does not add a hypothetical refresh field or store bearer tokens on disk.

## This slice

- `src-tauri/src/pkce_token_exchange.rs` consumes the Rust-only `CallbackDecision::Approved`; a denied callback never makes a network request. Approved code and verifier are zeroized on drop.
- Before sending, it requires an exact canonical HTTPS staging/preview VirgoStars endpoint with path `/chart-sync/v1/token`, no query, custom port, fragment or credentials, and an exact IPv4 `127.0.0.1` callback redirect. There is no production hostname fallback.
- The form is constructed with `url::form_urlencoded`, capped at 2 KB and zeroized. A `TokenHttpTransport` port receives the fixed URL/form plus a 10-second timeout and 8 KB response ceiling. **This is an injected interface, not a real HTTPS adapter:** the future implementation must verify TLS, prevent redirects, enforce both ceilings, set the form media type and avoid logging request/response secrets.
- The response must be HTTP 200 JSON with the exact four fields, `Bearer`, an appropriately shaped JWT, allowed read/read+notes scope, and an expiry of 1–900 seconds. Unknown or duplicate JSON fields (including invented refresh tokens), malformed content and errors are rejected. The raw JSON bytes and successful token holder are zeroized; the access grant has no `Serialize`, `Debug` or `Clone`.
- `serde_json` is now an unconditional dependency rather than an optional dependency of the ephemeris feature, so this Rust-only source does not become feature-dependent. Its package was already present in the dependency graph; **Cargo.lock must still be checked by Cargo on Windows**, not hand-edited.
- `src-tauri/src/lib.rs` only registers the module; **no Tauri IPC**, Angular UI, live user session, HTTPS call, database change, AWS operation, main merge, production enablement or GitHub Action is included.

This is a deliberately narrow and testable contract boundary: it does not claim to authenticate anyone yet. JWT signature, issuer, audience and account/device ownership remain enforcement responsibilities of the staging backend. The future Desktop HTTPS adapter must treat the `scope` field as display metadata, **not** a client-side authorization guarantee.

## Tests / acceptance

Node source-contract check (can be executed without Rust):

```sh
node --test tests/pkce-loopback-boundary.test.mjs tests/pkce-os-browser-boundary.test.mjs tests/pkce-native-token-exchange-boundary.test.mjs
```

Windows native verification (not executed in this environment):

```powershell
cd D:\GitHub\virgostars-desktop
node scripts/desktop-doctor.mjs --stage=build --json
cargo test --manifest-path src-tauri/Cargo.toml pkce_token_exchange::tests --locked
cargo test --manifest-path src-tauri/Cargo.toml system_browser::tests --locked
cargo check --manifest-path src-tauri/Cargo.toml --locked
```

After native compile and a verified staging backend/migration/consent flow exist, next steps are a reviewed no-redirect TLS HTTP adapter, a sandboxed native worker lifecycle, device-scoped credential policy, a scoped IPC contract exposing only opaque state, then real Windows WebView2 login and two-account security smoke tests. Before any long-lived login, design refresh-token rotation, device revocation, and safe offline behavior explicitly on the backend.
