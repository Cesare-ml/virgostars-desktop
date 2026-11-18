# Desktop PKCE loopback listener: bounded native candidate

**Status: isolated Rust source candidate; not activated or compiled in this execution environment.** Date: 2026-11-18. Stacked on the preceding Desktop native PKCE core draft PR #354.

## What this slice implements

- `LoopbackLogin::start` binds a **real IPv4-only OS socket** to `127.0.0.1:0`, gets the assigned ephemeral port, makes an attempt through `PendingPkceLogin` and calls an injected `SystemBrowserOpener` with the exact HTTPS VirgoStars consent URL. Binding occurs **before** the external browser opener can run. A failing opener cancels the attempt and closes the socket on drop.
- `wait_for_callback` runs only in a dedicated Rust worker (no Tauri command or live UI wiring), with an overall deadline capped at 10 minutes, up to 32 connections, per-connection header deadline and 4 KB request ceiling. A slow or malformed local request cannot block a socket forever.
- `httparse` validates exactly one `Host: 127.0.0.1:<bound_port>` and a complete HTTP/1.1 `GET` origin-form callback with no body/framing headers. Wrong method, duplicate Host, `Content-Length`, `Transfer-Encoding`, `Expect`, malformed headers or wrong path are rejected.
- The prior `PendingPkceLogin` code checks the absolute reconstructed callback URL, one-time OAuth state, authorization code syntax and expiry. Invalid requests receive a constant 400 page; the valid return receives a constant 200 page with `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, restrictive CSP and no reflected authorization code.
- A Rust-only default-browser adapter is supplied separately in `system_browser.rs`, but **is intentionally not yet wired to any command or UI**. The loopback unit tests still inject a fake browser. The backend consent route remains disabled and no account is activated.

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
The standalone `OsDefaultBrowser` module permits only the exact canonical
five-field native PKCE consent request, validated a second time at the launch
boundary (staging origin, `S256`, fixed client ID, loopback callback and 43-char
URL-safe state/challenge). Windows calls `ShellExecuteW` with the `open` verb to
use the registered default HTTPS browser without an executable-name search;
macOS uses `open --` and Linux uses `xdg-open` via direct
`std::process::Command` argument arrays. There is no shell, WebView,
environment-selected program or URL logging. A short native worker reaps the
POSIX child process. OS dispatch success does not prove the browser actually
loaded the page.

This change **does not automatically open a browser**, register a Tauri
command, exchange tokens or enable the login UI. New Rust tests validate the
launch policy without starting an external browser; new Node tests enforce the
module boundary. Rust compilation remains outstanding.

## Safety boundaries and remaining integration

The native result is a Rust-only `CallbackDecision` whose authorization code and verifier are zeroized when dropped. It is *not* an access token. The next host slice must first **compile and smoke-test the OS opener on Windows**, then implement native HTTPS token exchange, scope/audience validation and OS credential store. After security review, register a dedicated scoped Tauri IPC command and expose **only** the opaque status/result contract from Desktop draft PR #353.

The website needs a real authenticated and CSRF/Origin-protected consent form, and backend staging DB must have device grants and code-exchange endpoints configured. The listener cannot be considered end-to-end authenticated until those independent gates are fulfilled. It does not touch AWS, real user records, desktop archives, browser default settings, product releases or GitHub Actions.

## Tests and acceptance

`pkce_loopback.rs` includes host-only Rust tests for bind-before-launch, system-browser error, correct callback, malicious Host, disallowed HTTP framing/method and finite timeout. `system_browser.rs` adds native-only URL policy tests with no browser launch; **Rust tests have not been executed in this environment** because `cargo` and `rustc` are unavailable. Node source gates (`tests/pkce-loopback-boundary.test.mjs` and `tests/pkce-os-browser-boundary.test.mjs`) verify that neither module becomes a Tauri command and that the browser/PKCE ownership separation remains explicit.

On Mirko's Windows checkout, run:

```powershell
cd D:\GitHub\virgostars-desktop
cargo test --manifest-path src-tauri/Cargo.toml pkce_
cargo test --manifest-path src-tauri/Cargo.toml system_browser::tests
cargo check --manifest-path src-tauri/Cargo.toml --locked
npm test
```

These are still unit/source checks. Acceptance requires a Windows WebView2 + system-browser smoke test, consent callback/CSRF staging integration, verified token exchange, revocation, keychain lifecycle and an explicit Tauri security audit. Do not turn the default-off UI switch on as part of this PR.
