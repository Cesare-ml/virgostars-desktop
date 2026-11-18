# Desktop PKCE loopback listener: bounded native candidate

**Status: isolated Rust source candidate; not activated or compiled in this execution environment.** Date: 2026-11-18. Stacked on the preceding Desktop native PKCE core draft PR #354.

## What this slice implements

- `LoopbackLogin::start` binds a **real IPv4-only OS socket** to `127.0.0.1:0`, gets the assigned ephemeral port, makes an attempt through `PendingPkceLogin` and calls an injected `SystemBrowserOpener` with the exact HTTPS VirgoStars consent URL. Binding occurs **before** the external browser opener can run. A failing opener cancels the attempt and closes the socket on drop.
- `wait_for_callback` runs only in a dedicated Rust worker (no Tauri command or live UI wiring), with an overall deadline capped at 10 minutes, up to 32 connections, per-connection header deadline and 4 KB request ceiling. A slow or malformed local request cannot block a socket forever.
- `httparse` validates exactly one `Host: 127.0.0.1:<bound_port>` and a complete HTTP/1.1 `GET` origin-form callback with no body/framing headers. Wrong method, duplicate Host, `Content-Length`, `Transfer-Encoding`, `Expect`, malformed headers or wrong path are rejected.
- The prior `PendingPkceLogin` code checks the absolute reconstructed callback URL, one-time OAuth state, authorization code syntax and expiry. Invalid requests receive a constant 400 page; the valid return receives a constant 200 page with `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, restrictive CSP and no reflected authorization code.
- A reviewed concrete OS-browser adapter **is intentionally not supplied**. The trait allows a fake browser in tests, but does not launch one in the actual packaged app. The backend consent route is still disabled, and no account is activated.

## Staging origin guard (follow-up draft)

The native listener **no longer has a hardcoded public website consent
fallback**. The `LoopbackLogin::start(browser, staging_consent_page)` caller
must supply the URL explicitly from reviewed native staging configuration.
Before the system-browser adapter is invoked, the PKCE core enforces:

- HTTPS only, path exactly `/collega-dispositivo`, no query, fragment,
  userinfo or custom port;
- canonical URL string and a VirgoStars-owned `*.virgostars.it` hostname whose
  labels include exactly `staging` or `preview`;
- no production `virgostars.it` or `www.virgostars.it`, no attacker-controlled
  lookalike domain, no silent fallback to a different origin.

The sample `https://staging.virgostars.it/collega-dispositivo` in synthetic
tests is an **illustrative candidate**, not a claim that staging DNS/site
exists or has been deployed. The actual origin must be approved and matched
against the staging backend CORS/CSRF allowlist before a real browser test.
This change does not open a system browser, register a Tauri command,
exchange tokens or enable the login UI. Existing Node source tests plus a
new Rust guard test cover the intended boundary; Rust compilation remains
outstanding.

## Safety boundaries and remaining integration

The native result is a Rust-only `CallbackDecision` whose authorization code and verifier are zeroized when dropped. It is *not* an access token. The next host slice must implement a reviewed system-browser opener (for example an approved Rust-only Tauri opener API), native HTTPS token exchange, scope/audience validation and OS credential store. Then, after security review, register a dedicated scoped Tauri IPC command and expose **only** the opaque status/result contract from Desktop draft PR #353.

The website needs a real authenticated and CSRF/Origin-protected consent form, and backend staging DB must have device grants and code-exchange endpoints configured. The listener cannot be considered end-to-end authenticated until those independent gates are fulfilled. It does not touch AWS, real user records, desktop archives, browser default settings, product releases or GitHub Actions.

## Tests and acceptance

`pkce_loopback.rs` includes host-only Rust tests for bind-before-launch, system-browser error, correct callback, malicious Host, disallowed HTTP framing/method and finite timeout; **Rust tests have not been executed in this environment** because `cargo` and `rustc` are unavailable. Small Node source gates (`tests/pkce-loopback-boundary.test.mjs`) verify that this module is not a Tauri command and that the browser/PKCE ownership separation remains explicit.

On Mirko's Windows checkout, run:

```powershell
cd D:\GitHub\virgostars-desktop
cargo test --manifest-path src-tauri/Cargo.toml pkce_
cargo check --manifest-path src-tauri/Cargo.toml --locked
npm test
```

These are still unit/source checks. Acceptance requires a Windows WebView2 + system-browser smoke test, consent callback/CSRF staging integration, verified token exchange, revocation, keychain lifecycle and an explicit Tauri security audit. Do not turn the default-off UI switch on as part of this PR.
