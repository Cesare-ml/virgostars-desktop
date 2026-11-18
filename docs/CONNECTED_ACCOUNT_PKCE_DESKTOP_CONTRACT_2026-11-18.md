# Desktop connected-account login: native IPC contract candidate

**Status: Prototype contract only; not integrated.** Date: 2026-11-18. Backend coordination: VirgoStars web draft PRs #363–#367; these PRs are also not deployed.

## This increment

`src/app/native/connected-account-contract.ts` defines a data-only, fail-closed protocol for `start`, `status`, `cancel` and `disconnect`. The settings UI is wired to the command; ordinary native builds return disabled. A separate explicit staging-only Cargo feature and two allowlisted build-time endpoints are required even to attempt login. The connected-status schema is `contracts/connected-account-status.v1.schema.json`; tests check its scope and fields against the TypeScript decoder and Rust token exchange.

## Host ownership and next native implementation

1. Rust creates cryptographically random OAuth state and PKCE S256 verifier/challenge, binds an opaque UUID attempt ID and a short expiry to one pending authorization. Do not accept these fields from the WebView or generate them with `Math.random`.
2. Rust opens an explicitly configured, validated staging consent URL in the **system browser**, after real server login and CSRF/origin enforcement are available. The initial authorization parameters are in the URL fragment, not the HTTP query, to avoid sending them in web-server access logs. The website removes that fragment after parsing, but this alone does not guarantee browser-history removal. Production is not enabled by this candidate. No password prompt is embedded in the Tauri WebView. The site route and endpoint in the backend PRs are currently disabled and need independent security review.
3. Rust listens on a randomly selected **IPv4 loopback** port with exclusive binding and verifies the exact redirect URI, state, callback path, server result, code and expiry. Reject unexpected hosts, duplicate parameters, query fragments and replay. The fixed local response runs a CSP-hashed script to remove the callback query from the current browser history entry; this is best effort, not proof that the browser never persisted it. An Android App Link needs a separate mobile-native adapter; it is not part of the Desktop flow.
4. Rust exchanges the one-time code for the `chart_sync:read` token via HTTPS. The candidate response contains no device ID or refresh token. The current parser checks token shape, scope and lifetime, but does not itself verify issuer or audience; authenticated backend verification is required before reporting a connection. No persistent credentials are added. Do not reuse the existing read-only `desktop_runtime_info` IPC handshake for authentication.
5. Only **after successful server verification**, a native `status` reply may report `connected`, with `scope: chart_sync:read` and matching `attemptId`. Notes and writes require separate consent and are rejected by the current exchange. No token, code, verifier, state, URL, birth record, password, path or other unknown field may cross IPC. Support denial, expiry and cancellation.
6. Enforce a single pending attempt per desktop account context, invalidate previous attempts on restart or cancel, and bound polling/resource lifetimes. A host implementation must be registered in Tauri with an explicit capability review and e2e tests **before** enabling any frontend call.

## Privacy, authorization and offline scope

The frontend contract contains neither personal natal chart data nor secrets. This makes **no claim** that connected-account login, chart synchronization, token refresh, profile isolation or offline unlock are ready. An offline cached chart must remain under the independently reviewed encrypted archive and owner profile; remote revocation does not retroactively delete a physically offline copy. Server-side access checks, snapshot/delta and device revocation remain authoritative.

No database migration, AWS change, build-time secret, GitHub Actions, app release or main merge is involved. This is a separate **draft** Desktop PR targeting `main`, not an implicit merge of the VirgoStars web PR stack.

## Verification and missing acceptance

Run `node --experimental-strip-types --test tests/connected-account-contract.test.mjs` and `npm test` in a full Desktop checkout. The isolated contract can be tested under Node without installing Tauri. Must still run `npm run build:ui`, `cargo test`, native Windows WebView2/system-browser loopback smoke, and a staging end-to-end consent/token/device-revocation test when the real native host and reviewed website login are present.
