# Copilot synthetic loopback fixture — reproducible HTTP tests

**Status:** local Node HTTP test double, **not** the real Virgo Stars backend or an authentication provider. No OpenAI/Anthropic calls, real charts, accounts, personal data, provider fees or production services. Debug staging only. The fixture uses the same **shape** as private backend PR #160, but *never verifies JWT signatures*; it compares an ephemeral fictional token by timing-safe equality. This is not proof that real Virgo Stars auth works.

## Automated tests (no dependencies)

From the authorized Desktop checkout with Node.js 22+:

```powershell
node --test tests/copilot-staging-fixture.test.mjs
```

Also included in the repository's existing `npm test` script, which uses `--experimental-strip-types` for TypeScript imports in other tests.

The tests open a **random ephemeral port on literal `127.0.0.1`** and close it afterwards. They cover:
- GET `/api/v1/ai/copilot-preview/capabilities` with and without the synthetic test bearer.
- POST `/api/v1/ai/copilot-preview/message` for NATAL:VENUS, NATAL:SUN, TRANSIT:SATURN and the required synthetic FACT_ONLY envelope.
- Unknown API path, invalid focus, arbitrary prompt fields.
- 2 KiB body cap (including chunked streaming), malformed JSON and non-JSON Content-Type.
- Per-fixture quota 429, no-store headers and invalid-token refusal.

These are **real loopback HTTP tests in Node**, not isolated source-string checks. They do not execute the Rust native bridge or Express server.

## Optional manual Rust/Tauri IPC smoke on Windows

**Prerequisite:** an actual Windows Rust/Tauri debug build with explicit `copilot-staging` Cargo feature. The private backend PR #160 is *not* needed for this synthetic test double; real JWT authentication and the real Express code remain a separate acceptance gate.

Set these variables in a **throwaway PowerShell terminal** in the Desktop checkout. The random suffix is a **locally generated, unsigned test fixture**, not a valid signed JWT. Never reuse any real user's token.

```powershell
$env:VIRGOSTARS_COPILOT_PREVIEW_STAGING_ENABLED = "1"
$env:VIRGOSTARS_COPILOT_PREVIEW_STAGING_BACKEND_ORIGIN = "http://127.0.0.1:18883"
$env:VIRGOSTARS_COPILOT_FIXTURE_ACK = "SYNTHETIC_LOOPBACK_TEST"
$env:VIRGOSTARS_COPILOT_PREVIEW_STAGING_TEST_BEARER = node -e "console.log(['eyJhbGciOiJub25lIn0','eyJzdWIiOiJzeW50aGV0aWMifQ',require('node:crypto').randomBytes(24).toString('base64url')].join('.'))"
$fixture = Start-Process -FilePath "node" -ArgumentList @("scripts/copilot-staging-fixture.mjs", "18883") -NoNewWindow -PassThru
```

The fixture prints **only** its loopback URL. It never logs the bearer. Check that `GET /capabilities` returns HTTP 200 with an explicit `Authorization: Bearer` header. Unauthenticated requests must return 401.

Launch the **separately reviewed** Tauri development build with Cargo feature `copilot-staging` from this same shell so its Rust process inherits the synthetic variables. Confirm the installed Tauri CLI's feature-argument syntax and regenerate/review the currently missing `src-tauri/Cargo.lock` with Cargo first; do not substitute an unreviewed lockfile. The normal release build must exclude the command.

Expected UI path:
1. The AI panel starts disabled until Rust's authenticated `GET /capabilities` returns a valid synthetic contract.
2. Ask with each of the three supported synthetic focus choices: `POST /message` must return a sample FACT_ONLY answer, **not** a real chart interpretation.
3. Repeated requests eventually return 429; a simultaneous request must fail safely with a temporary busy state.
4. Stop the fixture, then use **Riprova connessione**. The preview must disable; offline charts must remain available.
5. An incorrect token must return 401; if authentication is rejected during POST, the UI must clear its ready state.

Clean up from the same PowerShell session:

```powershell
Stop-Process -Id $fixture.Id -ErrorAction SilentlyContinue
Remove-Item Env:VIRGOSTARS_COPILOT_FIXTURE_ACK -ErrorAction SilentlyContinue
Remove-Item Env:VIRGOSTARS_COPILOT_PREVIEW_STAGING_ENABLED -ErrorAction SilentlyContinue
Remove-Item Env:VIRGOSTARS_COPILOT_PREVIEW_STAGING_BACKEND_ORIGIN -ErrorAction SilentlyContinue
Remove-Item Env:VIRGOSTARS_COPILOT_PREVIEW_STAGING_TEST_BEARER -ErrorAction SilentlyContinue
```

## Boundaries / pending gates

- The synthetic fixture server binds **only 127.0.0.1**, never `0.0.0.0`, and requires an explicit opt-in acknowledgment for CLI launch. It is **not** a generalized HTTP proxy and has no DNS, provider API or production integration.
- The bearer is only an ephemeral equality-check secret. Do **not** use actual Virgo Stars access/refresh tokens, keys or real chart records. Successful fixture GET/POST does not mean a real JWT is valid, ownership was checked, or the private backend was run.
- The real backend's JWT guard, per-user rate limiter, Express request parser and revocation must be validated separately against PR #159/#160. The fixture's quota is only an approximation to exercise HTTP 429 and UI messaging.
- Native Rust Cargo checks, feature release exclusion, WebView2 UI, user cancellation and real HTTP end-to-end have **not** been run by this fixture's unit tests. No deploy/merge or GitHub Actions.
