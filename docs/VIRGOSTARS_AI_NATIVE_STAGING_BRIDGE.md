# Virgo Stars AI — native debug-only staging transport spike

**Status (2026-11-11):** implementation proposed in a draft branch, NOT merged, NOT validated as a Windows Tauri build, NOT production-ready.  
**Stack:** Desktop AI inspector PR #23; private Virgo Stars backend staging mock PR #160 (depends on #159).

## What this implements

A **narrow, debug-only** native HTTP bridge connecting the experimental Virgo Stars Desktop inspector to the **Virgo Stars private backend** (never directly to OpenAI, Anthropic or third-party model APIs).

```text
Angular dev WebView
  POST body { action: describe_focus, focus: NATAL:VENUS|SUN / TRANSIT:SATURN }
  -> typed local Tauri invoke("copilot_staging_preview", { focus })
  -> Rust debug+feature command
       only 127.0.0.1 with an explicitly configured port
       only POST /api/v1/ai/copilot-preview/message
       only synthetic staging-user JWT from process environment
       no user-selectable URL/provider/API key
  -> Virgo Stars local staging backend with its own JWT, quota and mock
  -> strictly bounded synthetic FACT_ONLY response
  -> Angular validates envelope and never executes synthetic chart commands
```

**Per-preview fixture session check:** In the synthetic lab, `scripts/copilot-staging-fixture.mjs` now tags **every successful POST** envelope with its one-time `labSession`. Native Rust validates that exact value inside `project_preview_envelope` **before projecting the response across Tauri IPC**; the projected JSON strips the lab ID. A fixture swapped after `GET /capabilities` can no longer produce an accepted preview from a different session. A shared `optional_fixture_session()` loader fails closed on malformed/non-Unicode environment values for both GET and POST **before issuing HTTP**. When the variable is absent, the true Virgo Stars staging backend retains its original `0.1.0` envelope and JWT authorization contract. This is an additional *lab-only* response identity check, not a defense against local processes able to steal the temporary token or an authentication system for real users.

**Local fixture session binding:** When `VIRGOSTARS_COPILOT_FIXTURE_SESSION` is set by the Windows synthetic lab launcher, **Rust itself** validates its exact 32-character lowercase hexadecimal shape before sending the bearer and requires the authenticated `/capabilities` JSON to echo the identical `labSession`. A mismatched or absent response fails closed even after the launcher has completed its one-time verification, protecting against switching local processes on the same port. When this environment variable is **absent**, the genuine private Virgo Stars staging backend remains compatible and does not need a `labSession` field. This lab-only identity check is **not** cryptographic JWT verification, proof of backend ownership, or a substitute for system-browser PKCE. The challenge is never exposed to Angular.

**Readiness now performs an authenticated staging check.** The Rust command `copilot_staging_ready` requires the explicit staging feature/flag, validated local origin and syntactically valid synthetic test JWT, then issues a **bounded authenticated GET** to `/api/v1/ai/copilot-preview/capabilities`. It accepts only HTTP 200 with `VirgoStarsCopilotPreviewCapabilities@0.1.0`, `STAGING_SYNTHETIC`, `providerEnabled=false`, `modelSelectorAvailable=false`, and the exact allowed focus/actions. Offline, 401/403, wrong contract or connection failures return only `false` to Angular, leaving the button disabled. The request is to a test-only **synthetic user**, not the production account system or an OAuth session. The AI inspector provides a manual **Retry connection / Riprova connessione** action: it calls the same bounded native check again and disables the Ask button during the request, so a staging backend started after Desktop launch can be detected without restarting the app. This is not background polling or automatic login.

**No real chart data, notes, birth time/place, or actual LLM messages leave the Desktop** in this spike. The command is **not** a login, token vault or real AI integration.

## Build protection

Rust module `src-tauri/src/copilot_staging_bridge.rs` and IPC command are registered only when **both** are true:

1. Rust compiled with `debug_assertions` enabled (a debug build).
2. Cargo feature `copilot-staging` was explicitly selected.

Additionally at runtime the command requires `VIRGOSTARS_COPILOT_PREVIEW_STAGING_ENABLED=1`. By default it does nothing. Normal release builds do not compile/register the command, even if the feature is accidentally supplied.

Angular injects the native transport only when `isDevMode() && isTauri()`; browser and compiled production Angular get `null`. In a native dev build, the UI calls the separate read-only `copilot_staging_ready` native command and leaves the AI request button **disabled** unless Rust returns `true` for the explicit feature/flag + valid loopback origin + synthetic JWT shape. The readiness probe performs a bounded, authenticated loopback HTTP GET, but exports **only a boolean** and never the JWT, origin or response contents to Angular. It proves only that the test backend accepted the synthetic staging JWT for the capabilities call—not account login or production authorization. If the Rust feature/command is absent or the environment is incomplete, the probe fails closed and the button stays disabled.

**Bounded local origin:** native staging now requires a literal `http://127.0.0.1:<explicit-port>` with a **non-system port 1024–65535**. A raw-source check runs before URL parsing, so normalized shorthand hosts such as `127.1`, leading/trailing whitespace, mixed-case schemes, noncanonical leading-zero ports and malformed authorities cannot silently pass. Both `http://127.0.0.1:3000` and `http://127.0.0.1:3000/` are accepted. URL parsing still rejects port 0, privileged ports 1–1023, out-of-range ports, credentials, extra paths, queries, fragments and redirects. Native unit cases cover both boundaries; TypeScript source regressions assert the guard is present. This applies **only to the optional debug staging bridge** and does not constrain the offline desktop service.

**Offline-first native compilation gate:** the Windows synthetic lab runner now invokes `cargo check --no-default-features` after formatting, **before** `cargo test --features copilot-staging` and `cargo check --release --features copilot-staging`. This is intended to catch regressions in the ordinary offline-first Tauri runtime independently of experimental AI code; those actual Cargo commands have not been run here.

No generic HTTP client is exposed to the webview and native CSP (`connect-src 'self'`) has not been changed.

## Dependency-free local HTTP fixture (now implemented)

An isolated Node.js fixture server is available as `scripts/copilot-staging-fixture.mjs`, with actual HTTP integration tests in `tests/copilot-staging-fixture.test.mjs` and a detailed runbook at [Synthetic loopback lab](VIRGOSTARS_AI_STAGING_FIXTURE_LAB.md). It can imitate the two staging API routes while validating the limited Rust/Angular **protocol shape**, without Express, an externally signed JWT, personal charts, real provider inference or an installed production backend. The fixture requires an explicit opt-in, binds literal `127.0.0.1` only and verifies a **fictional unsigned token by equality**, not JWT signatures. Passing its tests **does not validate the real Virgo Stars server's authorization**.

The **current 9/9 synthetic HTTP test cases passed under Node.js v22.16.0** in a freshly recreated isolated local checkout, including the actual Desktop TypeScript preview decoder over live loopback requests (401, 200, 400, 413 with chunked streaming, 415 and 429), distinct per-instance session IDs, response shape, quotas, and CLI refusal without explicit opt-in. The three locally staged files were verified against their GitHub blob hashes: `scripts/copilot-staging-fixture.mjs` = `d9d69461722c36110500d636288267c06256cc9e`, `src/app/copilot-preview-client.ts` = `b8fe0fb614f4238f27e4375810cd6a95fafa9b35`, and `tests/copilot-staging-fixture.test.mjs` = `efd210e3a04cae40377bffd4f6ed2c0903766cf2`. This is a real Node HTTP integration run, **not** a Windows/Tauri/Rust runtime test. The executable and tests were subsequently committed to this draft GitHub branch. A native Rust/Windows build, an actual WebView2 loopback test and private backend JWT integration are still unverified.

## Windows debug lab launcher

There is now a separate **explicit synthetic-only Windows runner** in [`scripts/run-copilot-staging-lab.ps1`](../scripts/run-copilot-staging-lab.ps1). From the Desktop checkout, after the prerequisites in [Windows build gate](WINDOWS_BUILD_GATE.md), run:

```powershell
powershell -NoProfile -File .\scripts\run-copilot-staging-lab.ps1 -SyntheticOnly
```

It validates the Node fixture tests, the complete `npm test` suite, frontend/Charts build prerequisites via `npm run doctor:build`, `cargo fmt`, Rust staging-feature tests and a release-feature compilation check, starts Angular **before** creating the fictional token, then starts the local fixture and Tauri **DEBUG with `--features copilot-staging`**, cleaning up owned processes and temporary variables afterwards. It refuses to overwrite inherited staging environment variables and does not perform deploys or merges. The Windows PowerShell launcher also uses an **exclusive local bind** to check ports, and a no-proxy/no-redirect, localhost-only, 8 KiB bounded HTTP reader for its synthetic capabilities preflight, matching the Rust transport's threat boundary. The script itself now has ten source-contract tests in `tests/copilot-windows-lab-runner.test.mjs`, including exact validation of a cryptographically random per-launch fixture challenge returned by `/capabilities`. These **10/10 source assertions passed in an isolated V8 runner**, not in PowerShell or Windows. The launcher additionally validates the exact `0.1.0` contract version, the one permitted action and all three allowed focus choices before launching Tauri. The local challenge does not validate an actual Virgo Stars JWT. The current 9-case HTTP fixture suite **passed 9/9** under Node.js 22.16 using hash-identical copies of the three files committed on this branch. The Rust bridge now contains **10 unit tests**, including the optional fixture session validation; they require a real Cargo build to execute. The real Windows Rust/Angular/WebView2 run remains an outstanding acceptance gate.

See [Synthetic loopback lab](VIRGOSTARS_AI_STAGING_FIXTURE_LAB.md) for a separate manual mode and the test protocol.

## Local staging setup — synthetic test accounts ONLY

This is a *manual testing recipe*, not an installed environment or proof of working integration.

- Run the **separate Virgo Stars staging backend** on `127.0.0.1:<explicit-port>` with all its staging guards satisfied, isolated DB, appropriate external JWT keys and `VIRGO_STARS_AI_COPILOT_MOCK_ENABLED=1`. The backend PR #160 must first be tested and integrated.
- The bearer must be a **short-lived staging user access token**, never a production user token, OpenAI API key or permanent secret. **Do not put any token in repository files, Angular environment, command-line arguments, screenshots, issues or test logs.** Set process environment safely for the temporary native development session; clear it when done.
- For the native Rust process the following names are required:

```text
VIRGOSTARS_COPILOT_PREVIEW_STAGING_ENABLED=1
VIRGOSTARS_COPILOT_PREVIEW_STAGING_BACKEND_ORIGIN=http://127.0.0.1:<explicit-port>
VIRGOSTARS_COPILOT_PREVIEW_STAGING_TEST_BEARER=<short-lived-staging-user-JWT>
```

Run a DEBUG Tauri build **with** the explicit Cargo feature. The existing Tauri CLI launch scripts may need an additional dedicated dev command that forwards features after verifying tooling versions; **no production launcher is modified here**. Use a synthetic account and a private local staging environment; no real birth records.

**Security caveat:** environment variables are a temporary developer-only alternative to the future native OS credential vault. They may be accessible to local processes. Never use this workflow with real people, production sessions or released builds. This is NOT the final auth architecture; move to system-browser PKCE + OS-protected token storage with per-user revocation controls before production.

## Security checks in native Rust

- The preview request button stays disabled unless the *backend actually returns* an authenticated, validated staging-only capabilities envelope; a configured URL alone is insufficient.
- Native `project_preview_envelope` validates the response against the expected selected layer/body, deterministic source, draft-only status, zero provider cost and false personal-data disclosures. It enforces a safe integer revision, bounded nonempty answer, exactly one allowed `chart.highlightAspects` command, unique synthetically namespaced aspect IDs and a maximum of 80 aspects. **It creates a fresh minimal JSON envelope:** arbitrary backend fields such as request identifiers, private notes, tokens, extra commands or private chart data are **not forwarded into Angular**. These IDs remain display-only and never mutate the actual chart.
- The native Rust reader limits both GET and POST JSON bodies to 8 KiB and rejects invalid content types before deserializing.
- Strict typed focus allowlist: only natal Venus/Sun or transiting Saturn.
- Fixed backend endpoint path; URL origin restricted to literal HTTP `127.0.0.1` with explicit port, no hostnames, query/fragment, credentials, additional paths or redirects.
- HTTP request with bounded JSON only, native JWT from process environment, no WebView exposure of tokens.
- Shared five-second timeout, redirect policy NONE and `reqwest::ClientBuilder::no_proxy()` for both the read-only GET capabilities and the POST preview, preventing forwarding the synthetic JWT to inherited `HTTP_PROXY`/`ALL_PROXY` processes.
- **Authorized-session freshness:** the successful capabilities GET is only a staging snapshot. A later preview POST can receive 401/403 (revoked or expired JWT) or 429 (the backend per-user quota). Rust emits only fixed `copilot_staging_not_authorized` or `copilot_staging_rate_limited`; the Angular adapter recognizes those **exact strings only**, maps to safe internal codes, and redacts arbitrary native error messages. On authorization rejection the UI clears `copilotPreviewReady` and disables further Ask requests until a new explicit authenticated capabilities check succeeds. Quota rejection shows a localized temporary-limit notice; it does not claim the session is revoked or retry in a loop.
- **Truthful selection text:** the inspector displays `Test selection / Selezione di prova` rather than saying the service is ready when only a planet was selected. This remains a synthetic fixture, unrelated to the visible chart.
- **Native single-flight backpressure:** an atomic RAII permit covers both the authenticated GET capabilities and POST preview. At most **one local staging HTTP request** may be in flight per Desktop process; overlapping GET fails closed as `false`, and overlapping POST returns sanitized `copilot_staging_busy` (the Angular transport maps **only this exact** Rust string to `copilot_preview_busy` and a localized IT/EN *request still in progress* message; all other native error texts remain redacted). The permit is released automatically on completion, HTTP failure, timeout or native future cancellation, so abandoned WebView requests cannot accumulate unbounded native work. The client never queues retries in the background. The native network timeout remains five seconds. This is a staging development constraint, not the production AI request scheduler.
- Reject non-200 responses, unexpected content type, response bodies over 8 KiB (checked incrementally), and non-synthetic/AI-enabled envelopes.
- All errors converted to generic client-safe codes; no API key, token, host or HTTP body is logged.
- No cloud/HTTP functionality in normal releases.

The backend has its own staging JWT middleware and per-user rate limit. Neither Rust nor Angular can replace backend authorization.

## Verification

**Added source tests:**
- Rust `#[cfg(test)]`: focus allowlist, URL/SSRF restrictions, staging JWT shape, *pure* fail-closed readiness predicate (no process-global env mutation), exact capability contract, FACT_ONLY envelope gate, minimal JSON projection (removes unexpected secrets), and rejection of mismatched focus, provider costs, personal disclosures, unsafe commands and IDs. Includes a pure atomic-permit test for concurrent acquisition and automatic release after scope exit (without mutating shared process state).
- Node `tests/copilot-native-staging-transport.test.mjs`: only the expected command, separate boolean-only readiness probe, forged payload rejection, browser denial, stale-result cancellation, error redaction, proxy bypass, source-gate checks, and a regression assertion that Rust sends **only the projected** response over Tauri IPC. Added tests cover exact 401/403 and 429 error classification without native-error leakage, plus UI and IT/EN source-level regressions for the readiness indicator.

**Required commands once checked out on Windows and Node/Rust toolchains available:**

```powershell
npm.cmd test
npm.cmd run build:ui
npm.cmd run verify:css
cd src-tauri
cargo test
cargo test --features copilot-staging
cargo check --features copilot-staging
cargo check --release --features copilot-staging
```

**Dependency note:** `reqwest` is an optional Cargo feature dependency; `Cargo.lock` must be regenerated/reviewed using Cargo and committed by a subsequent checked local build. Do not treat an untested lock as reproducible.

### Unverified gates

1. Real local Windows compilation and WebView2 IPC call; Cargo/Angular/Node tests on pushed branch.
2. HTTP staging smoke with a short-lived synthetic JWT.
3. Native feature check: no staging command present in actual release binary.
4. Host/port/JWT privacy controls and CSP review.
5. Full offline guest functionality with network disconnected.
6. Future PKCE + secure OS credential vault, session refresh and logout/disconnect.

## Follow-up

After local build and staging smoke, replace the debug-only environment JWT with a *real optional* reviewed browser-PKCE + OS credential vault native transport, then attach server-authoritative owner-scoped astrology facts. Keep all OpenAI API configuration/provider routing/metering in Virgo Stars private backend and production disabled until quality gates pass.

**No deploy, account migration, GitHub Actions, release, default production endpoint, model selector or merger into main.**
