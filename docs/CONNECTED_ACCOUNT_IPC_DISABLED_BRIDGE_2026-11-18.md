# Connected account IPC v1 — staging candidate

**Prototype; default disabled; not deployed or live-tested.** The settings
panel calls `desktop_connected_account_v1`; ordinary builds return precisely
`{protocolVersion: 1, status: "disabled"}` and do not launch a browser.
Browser preview also remains offline. The original `charts:read`/`deviceId`
mismatch is corrected to `chart_sync:read` with no fabricated device ID.

An experimental build must explicitly enable the Cargo feature
`staging-connected-account` and provide both compile-time values
`VIRGOSTARS_DESKTOP_STAGING_CONSENT` and `VIRGOSTARS_DESKTOP_STAGING_TOKEN`.
The existing native allowlists reject production, non-HTTPS and untrusted
hosts even with the feature enabled. No setting or URL inside the WebView
can switch endpoints or enable this feature. No deployment is implied.

The v1 request has exact fields and supports `start`, `status`, `cancel` and
`disconnect`, binding all follow-up operations to the native UUID attempt.
The native registry allows one attempt, dispatches browser launch on a
blocking worker, checks the backend session before reporting `connected`,
and clears its grant on disconnect, expiry or app shutdown. The UI receives
only public phase, attempt ID, bounded lifetime and `chart_sync:read`. Tokens,
authorization codes, verifier, OAuth state and URLs never enter the WebView.
Disconnect clears native memory; backend revocation is not yet wired, so a
previous bearer may remain valid until its short expiry. No refresh or
persistent login is implemented, and restart begins disconnected.

Rust/Cargo unit tests, source-contract tests and Windows builds provide local
evidence only. A real backend, TLS negative tests, browser history/log review,
two-account isolation and Windows GUI/offline acceptance remain mandatory
before activation; the backend consent and routes are still candidates.
