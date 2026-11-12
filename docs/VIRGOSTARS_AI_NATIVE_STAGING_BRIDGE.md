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

The **current 11/11 synthetic HTTP tests passed under Node.js v22.16.0** in an isolated local workspace, exercising the live loopback fixture and actual TypeScript preview decoder. They cover 401, 200, 400, 413 including chunked streaming, 415 and 429; separate launch challenges; invalid preview payloads; misleading disclosure/provider-cost flags; CLI refusal without explicit opt-in; and **a deliberately stalled trickle upload terminated after the fixture's 3-second absolute body-read deadline**. The local files were verified against the exact GitHub blob hashes: fixture `963584190ef8f9bc3d8fb1b7add1b0c845f31a15`, decoder `b061db75b79a059b24493d4efef99037221699cb`, tests `dd97b99f859e6fcb4d9482ff87c1a5b7f4a0409a`. A native Rust/Windows build, WebView2 end-to-end test and signed private backend authentication remain unverified.

## Windows debug lab launcher

There is now a separate **explicit synthetic-only Windows runner** in [`scripts/run-copilot-staging-lab.ps1`](../scripts/run-copilot-staging-lab.ps1). From the Desktop checkout, after the prerequisites in [Windows build gate](WINDOWS_BUILD_GATE.md), run:

```powershell
powershell -NoProfile -File .\scripts\run-copilot-staging-lab.ps1 -SyntheticOnly
```

It validates the Node fixture tests, the complete `npm test` suite, frontend/Charts build prerequisites via `npm run doctor:build`, `cargo fmt`, Rust staging-feature tests and a release-feature compilation check, starts Angular **before** creating the fictional token, then starts the local fixture and Tauri **DEBUG with `--features copilot-staging`**, cleaning up owned processes and temporary variables afterwards. It refuses to overwrite inherited staging environment variables and does not perform deploys or merges. The Windows PowerShell launcher also uses an **exclusive local bind** to check ports, and a no-proxy/no-redirect, localhost-only, 8 KiB bounded HTTP reader for its synthetic capabilities preflight, matching the Rust transport's threat boundary. The script itself now has ten source-contract tests in `tests/copilot-windows-lab-runner.test.mjs`, including exact validation of a cryptographically random per-launch fixture challenge returned by `/capabilities`. These **10/10 source assertions passed in an isolated V8 runner**, not in PowerShell or Windows. The launcher additionally validates the exact `0.1.0` contract version, the one permitted action and all three allowed focus choices before launching Tauri. The local challenge does not validate an actual Virgo Stars JWT. The current 11-case HTTP fixture suite **passed 11/11** under Node.js 22.16 using hash-identical copies of the three files committed on this branch. The Rust bridge now contains **11 unit tests**, including the optional fixture session validation; they require a real Cargo build to execute. The real Windows Rust/Angular/WebView2 run remains an outstanding acceptance gate.

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

## Prompt cancellation and strict TypeScript compatibility (2026-11-12)

The WebView can change the selected planet or chart mode while Rust still has a pending `copilot_staging_preview` IPC call. `createNativeCopilotStagingTransport` now attaches an **abort listener** to that specific pending Promise, so the Angular caller receives `copilot_preview_cancelled` immediately instead of waiting up to the native HTTP timeout. Native IPC itself is **not cancelled**; the later Rust result or error is consumed and **never forwarded to the new selection**. Both successful completion and cancellation remove the abort listener, preventing accumulation of listeners after repeated previews. The Rust native single-flight permit still bounds outstanding HTTP transactions and may briefly report `busy` if the user starts another request before the cancelled native call completes.

An actual **strict TypeScript build error** was also found and fixed: reconstructing `{ layer: focus.layer, bodyId: focus.bodyId }` widened the discriminated `CopilotPreviewFocus` union, so a safe natal/transit focus no longer satisfied the IPC request type. The client now uses `Object.freeze({ ...focus })`: `isCopilotPreviewFocus` already enforces exactly the two allowlisted properties, and the spread preserves the validated union and detached immutable IPC payload. A new `npm run test:ai:types` script runs an isolated strict compiler gate without needing the sibling Charts build and is included in the synthetic Windows preflight before any fictional credentials are created.

**Checks executed:** using Node.js v22.16.0 and TypeScript v5.8.3, `tsc --noEmit --strict --target ES2022 --module ES2022 --moduleResolution bundler --allowImportingTsExtensions src/app/native/copilot-staging-transport.ts` **passed**. The two local sources were verified byte-for-byte against GitHub blobs: `src/app/native/copilot-staging-transport.ts` = `a0a0ca792fb5c9e451b8815422407793aafeca1e`; `src/app/copilot-preview-client.ts` = `c9215620d39b71ee85763d6341eef6f011a38068`. A Node 22 behavior smoke on the identical native transport source passed **3/3**: immediate abort, suppressing late results, and removing listeners on both success and cancellation. The prior 11-case synthetic HTTP suite was also rerun with **11/11 passing** against the newly compiled client. The 3 new cases were committed to `tests/copilot-native-staging-transport.test.mjs` for the full repository test suite; **the entire suite and Windows/Angular/Tauri/Rust builds have not yet run**.

## Snapshotting the selected focus across asynchronous replies (2026-11-12)

The selected natal/transit body is validated by `isCopilotPreviewFocus` before a request starts. Previously the IPC request used a detached frozen copy but the later response decoder compared the returned body against the **original caller-owned focus object**. A caller mutating that object while the native/HTTP request was in flight could therefore change which body the decoder considered expected, despite the request having been sent for a different body.

`requestCopilotPreview` now snapshots the validated focus **once, before the first await**, as `const selectedFocus: CopilotPreviewFocus = Object.freeze({ ...focus })`; the same snapshot is used for the outgoing allowlisted IPC request **and** the returned envelope comparison. `readCopilotPreviewReply` additionally returns its own frozen focus copy, rather than leaking the caller-supplied object into the immutable reply. This preserves the TypeScript discriminated union for natal/transit planets and does not add any URL, arbitrary prompt, chart data, permission, or native feature.

**New regression cases** in `tests/copilot-preview-client.test.mjs` cover mutation of a valid mutable focus during an in-flight Promise and the identity/immutability of a directly decoded reply. Both were executed with **real Node.js v22.16.0 (2/2 pass)** using the updated client, which exactly matches GitHub blob SHA `09279c601b8323553479ab0d0b3f3e7000e7673f`. As a negative regression control, replacing the snapshot/return copy with the former caller-reference behavior caused **both tests to fail (0/2)**, and restoring the latest client made both pass again. A strict TypeScript v5.8.3 compiler check of the native/client boundary and the existing **11/11 live loopback HTTP fixture tests** also passed against this same client revision. Full Angular/Tauri/Cargo and Windows native validation remain pending.

## Native IPC single-flight after UI cancellation (2026-11-12)

A WebView abort does not cancel the Tauri/Rust network request. The native bridge already holds a one-at-a-time HTTP permit until its request finishes or times out (five seconds), but previously Angular could immediately issue another `copilot_staging_preview` invoke after changing the selected planet. Rust correctly returned `busy`, yet this still created unnecessary duplicate IPC traffic.

The per-instance `createNativeCopilotStagingTransport` adapter now maintains a **local native-preview-in-flight guard**. When the WebView aborts, its request still rejects immediately with `copilot_preview_cancelled`, but the adapter returns the existing safe `copilot_preview_busy` code on subsequent preview attempts **without invoking Tauri again** until the original native Promise finishes. It resets this guard only on native resolution/rejection, including failures thrown synchronously by the Tauri adapter. The already-installed cancellation handler continues to consume abandoned native errors and discard late responses. The Rust global RAII permit remains authoritative across all IPC callers and capability checks; this JavaScript guard is only a secondary efficiency/safety measure. No queue, retry timer, background request, extra native command or provider access was added.

**Actually executed:** a new self-contained `tests/copilot-native-single-flight.test.mjs` suite passed **3/3** under Node.js v22.16.0, checking concurrent calls, abort while native still pending, recovery after native completion and synchronous/late failures. The native adapter source and new test matched the exact GitHub blob SHA IDs `048ad75664626610dc2cf9fe944318db0a877a4c` and `102950dacd11ea2138863d36a6c964dcd982bb39`. Against the previous adapter, the overlapping-call regression did **not** pass; after the change, a combined run of the **3 IPC tests plus 11 live HTTP fixture tests passed 14/14**. The isolated TypeScript v5.8.3 strict check of the adapter also passed. Existing `tests/copilot-native-staging-transport.test.mjs` was updated to expect `busy` before the old native request settles, avoiding a stale assertion. **The entire Desktop npm suite, native Cargo check and Windows/Angular/Tauri WebView2 remain unverified.**

## Manual readiness vs cancelled-but-still-pending native preview (2026-11-12)

A new failure mode was found after adding immediate WebView cancellation: selecting another planet can clear Angular's `copilotBusy` flag while the previous Tauri/Rust HTTP request remains active. If a user clicks **Retry connection / Riprova connessione** at that moment, Rust's shared single-flight permit returns `false` for the overlapping capabilities GET. This is **busy**, not evidence that Virgo Stars staging has disconnected; previously the inspector could incorrectly clear its last confirmed ready state.

The native debug transport now exposes an **optional, local-only** `isPreviewPending?(): boolean` method through `VirgoStarsCopilotPreviewTransport`. It reports only the per-transport pending flag (no backend origin, session ID, JWT, account status or other sensitive data); other implementations may omit it. `isAvailable()` also refuses to issue a redundant Tauri readiness IPC while a native preview is still in flight.

The Angular inspector checks `copilotNativePending` before starting either the manual readiness probe or a new Ask request. When native work is still active it displays the existing localized `ai.preview.busy` state and **retains the prior `copilotPreviewReady` value**, rather than treating the occupied Rust slot as offline. It performs **no automatic retry or queued request**: after the previous native operation finishes, the user may press Retry again. The existing Rust RAII single-flight guard continues to enforce the process-wide limit; this transport flag protects the local UI from false status transitions only.

**Actually executed:** with exact source copies verified against GitHub blob hashes, `node --experimental-strip-types --test tests/copilot-native-single-flight.test.mjs tests/copilot-staging-fixture.test.mjs` passed **16/16 real Node.js 22.16.0 tests** (5 native adapter tests and 11 bound-loopback HTTP tests). The isolated strict `tsc` check of the native transport and its TypeScript client passed with TypeScript 5.8.3. The new Angular source-contract regression was executed against current GitHub content in an isolated V8 harness (**1/1 pass**); no full Angular/Charts compile or Windows WebView2/native Rust run was executed. Verified GitHub blob SHAs: native adapter `4084773acad1df45df0ff04fcc8b543e7b04594b`, preview client `0dbe44052c955651014cc7bb69b86f7cb78928b2`, native single-flight tests `c111367d8773213d3f62077ba58ab60e97657422`.

## Coalesced native readiness and bidirectional single-flight (2026-11-12)

The earlier local guard prevented duplicate `copilot_staging_preview` IPC calls and blocked a readiness GET while a preview POST was active. It did **not** prevent two independent `isAvailable()` calls from issuing overlapping `copilot_staging_ready` IPC calls, or a preview POST from overtaking an in-flight readiness GET. Rust correctly allows only one request globally, but that contention could appear as an avoidable offline/busy result in the developer inspector.

The optional debug transport now tracks `nativeReadinessInFlight: Promise<boolean> | null`. Concurrent readiness calls **share the same bounded authenticated result**, issuing only one native GET. A POST request made while that GET is still outstanding receives the existing redacted `copilot_preview_busy` result **without issuing another native IPC call**. The readiness guard clears in `finally` after success, native rejection or even a synchronous `invoke` exception, so the next explicit Retry can run normally. It is not a cached login state, automatic poller, background retry or new backend API. The existing Rust process-wide HTTP permit remains the authoritative cross-caller protection.

**Verification for this increment:** the 8 unchanged JavaScript test callbacks from `tests/copilot-native-single-flight.test.mjs` were executed against the **current GitHub transport source** in an isolated V8 runtime, after mechanically removing TypeScript-only annotations and substituting a minimal compatible `AbortController` implementation: **8/8 passed**. This is a genuine behavioral check but **not** a Node `--test` run, TypeScript compile, Windows WebView2 check or Cargo execution for this latest revision. The exact current file blobs are `src/app/native/copilot-staging-transport.ts` = `18f0d90c4837b79f47e7c3df235c74987cc69930` and `tests/copilot-native-single-flight.test.mjs` = `23a64d3c41fea1c03d2ca4d521317e0770ee6aae`. The prior full 16/16 Node fixture/IPC tests and isolated `tsc` pass apply to the **preceding** transport revision, not this latest one. Use `npm.cmd test` and `npm.cmd run test:ai:types` on the authorized Windows checkout to validate it fully.

## Standalone AI bridge smoke command (2026-11-12)

The Desktop now exposes `npm run test:ai:smoke` as one explicit Node.js 22+ gate for the five AI bridge suites: `copilot-preview-client`, `copilot-native-staging-transport`, `copilot-native-single-flight`, `copilot-staging-fixture` (real bounded loopback HTTP), and `copilot-windows-lab-runner`. It does not import or build the sibling Charts renderer and can therefore be run **before** installing the full Angular/Charts prerequisites. The Windows synthetic lab runner invokes this gate before `npm test`, `npm run test:ai:types`, the Angular build doctor, Cargo, or creation of any fictional bearer.

The standalone command is committed and its composition has source-level regression coverage. It has **not yet been executed in a full authorized checkout** in this environment (the private repository cannot be cloned from the local runner). The eight existing source-only native bridge checks and ten launcher tests were evaluated against current GitHub contents in the isolated V8 source harness, but they do not replace the actual `node --test` execution. On Windows, run the smoke first, then the strict TypeScript check and full build gates as documented below.

## Bounded Windows capabilities preflight body-read duration (2026-11-12)

The explicit synthetic-only Windows lab previously checked that every `Read()` had a 2-second socket timeout and capped the overall JSON body at 8 KiB. A local service trickling a byte every second could keep the authenticated response-body loop alive arbitrarily long because a **per-read timeout does not impose an overall response deadline**.

`scripts/run-copilot-staging-lab.ps1` now starts a `[System.Diagnostics.Stopwatch]` when reading the capabilities HTTP body and rejects an incomplete response if elapsed read time reaches **5,000 milliseconds**. The checks run immediately before and after each blocking read. A single read may add up to the existing 2-second socket timeout, so this is a bounded total-read policy rather than a guarantee of returning at exactly five seconds. The 8 KiB limit, no-proxy/no-redirect loopback restriction, and per-read timeout remain unchanged. `tests/copilot-windows-lab-runner.test.mjs` includes a regression that checks the ordering, deadline, resource disposal and size limit.

**Validation executed:** 11/11 Windows lab source-contract JavaScript callbacks passed in an isolated V8 harness against the current GitHub source: PowerShell runner blob `d81b3c902daa868dfdb36d12a6f03fe6514af787`, test blob `b5693f03286a30c18afdcd1c8b7a24a163984a80`. This does **not** establish actual PowerShell execution, a Windows HTTP slow-trickle runtime test, Tauri GUI correctness or Rust compilation. Those Windows-native checks remain to be run.

## Fail-closed Tauri environment detection (2026-11-12)

The optional debug native transport previously called `native.isNative()` outside its HTTP/IPC exception handling. Although the built-in host normally returns a boolean, an unexpected exception (including a native message with local private details) could escape directly from `isAvailable()` or `postJson()` to another frontend caller; a truthy non-boolean return could also be treated as native availability.

`src/app/native/copilot-staging-transport.ts` now uses a small `nativeAvailable()` guard which accepts only literal `true` and catches unexpected native availability errors without propagating the exception. The capabilities probe returns `false`; a preview request instead rejects with the existing sanitized `copilot_preview_native_unavailable` code. Neither path calls Tauri IPC in that situation. This does not enable remote backends, change login, expose tokens or affect the offline chart path.

Two new tests in `tests/copilot-native-staging-transport.test.mjs` exercise a throwing environment detector with a fictional sensitive message and non-boolean truthy/falsy return values. **2/2 actual test callbacks passed** in an isolated V8 JavaScript harness using mechanically type-erased current GitHub TypeScript logic. Verified GitHub blobs: transport `04dd56b8ddc8c56b90777da8551d11d0a2b830f0`, tests `ddf7c2d653cd50e32f26c1de4027843f8854c144`. The complete `npm run test:ai:smoke`, Angular build, Windows PowerShell/Tauri/WebView2 and Rust Cargo verification were **not** executed for this new revision.

## Native IPC focus snapshot and accessor hardening (2026-11-12)

The staging WebView adapter formerly called `isCopilotPreviewFocus(body.focus)` and then read `body.focus.layer` and `body.focus.bodyId` **again** when building the Tauri `copilot_staging_preview` payload. Mutable, getter-backed or proxy-backed JavaScript objects could return different values between validation and IPC, even though the normal Angular caller uses a frozen, validated focus. A getter could also throw an arbitrary exception containing local implementation details before reaching the native error-redaction handler.

`src/app/native/copilot-staging-transport.ts` now checks the exact two top-level request fields and the two supplied focus fields, then **samples their values into a new inert local object exactly once**. The snapshot must independently pass the three-value `isCopilotPreviewFocus` allowlist before it is sent as the **only** focus payload to Tauri; no free text, backend URLs or provider identifiers are introduced. All validation/accessor exceptions are converted to the fixed `copilot_preview_invalid_native_request` error and never trigger native IPC. This does not affect the Rust-side focus allowlist or release feature gate.

Two new Node-style test cases in `tests/copilot-native-staging-transport.test.mjs` check a changing getter and exceptions thrown from focus and top-level action getters and proxy key enumeration. The **2/2 test callbacks passed** against the current exact GitHub TypeScript logic in an isolated V8 runner with TypeScript-only annotations erased, transport blob `3a45c014d9d8aa0a62728d28605373e967c58e99` and test blob `164c215c6c134acdf6565471e0c90c67e4eb29ff`. A before/after negative control verified the former adapter did send an unallowlisted focus `TRANSIT:VENUS` after a getter changed values and leaked an arbitrary thrown getter error, demonstrating that the regressions address real behavior. **No complete npm test, strict tsc, Windows PowerShell, Angular/WebView2 or Rust/Cargo run was executed for this revision.**

## Verification

**Added source tests:**
- Rust `#[cfg(test)]`: focus allowlist, URL/SSRF restrictions, staging JWT shape, *pure* fail-closed readiness predicate (no process-global env mutation), exact capability contract, FACT_ONLY envelope gate, minimal JSON projection (removes unexpected secrets), and rejection of mismatched focus, provider costs, personal disclosures, unsafe commands and IDs. Includes a pure atomic-permit test for concurrent acquisition and automatic release after scope exit (without mutating shared process state).
- Node `tests/copilot-native-staging-transport.test.mjs`: only the expected command, separate boolean-only readiness probe, forged payload rejection, browser denial, stale-result cancellation, error redaction, proxy bypass, source-gate checks, and a regression assertion that Rust sends **only the projected** response over Tauri IPC. Added tests cover exact 401/403 and 429 error classification without native-error leakage, plus UI and IT/EN source-level regressions for the readiness indicator.

**Required commands once checked out on Windows and Node/Rust toolchains available:**

```powershell
npm.cmd test
npm.cmd run test:ai:types
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
