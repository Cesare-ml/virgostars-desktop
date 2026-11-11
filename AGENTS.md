# AI and human contributor instructions — VirgoStars Desktop

**Scope:** private, design-stage desktop client. These instructions are normative for work in this repository.

## Read before any change
1. `README.md`; `docs/ADR-0001-TECH-STACK.md`; `docs/ARCHITECTURE.md`.
2. `docs/OFFLINE_AUTH_AND_SYNC.md`; `docs/SECURITY_AND_PRIVACY.md`; `docs/ROADMAP.md`.
3. `docs/LICENSING_AND_PUBLICATION.md`; applicable upstream `AGENTS.md` and public package contracts.
4. Existing issues, draft PRs and recent commits, including UI guidelines in separate design PR #2. Avoid conflicts or duplicate work.
5. [Shell 001](docs/SHELL-001.md) for the Angular UI prototype and safe build prerequisites.
6. [Offline asset pipeline](docs/ASSET_PIPELINE.md) before modifying Angular asset handling; the synthetic manifest is not permission to redistribute original art.
7. [Native runtime bridge](docs/NATIVE_RUNTIME_BRIDGE.md) before adding Tauri IPC. The v1 command is read-only; never re-purpose it for login or astronomical calculations.

## Non-negotiable boundaries
- The private repository is **not** presently open source. No LICENSE has been selected. Do not infer a license from dependencies or copy a LICENSE from another repository without approval.
- Never modify VirgoStars production, migrations, user accounts, Astrolabio installations, AWS, DNS, release endpoints or other repositories as a side effect. Cross-repo changes require a separate authorized task.
- Never copy private user birth records, tokens, passwords, production DB dumps, API secrets, keys or unapproved original assets into this repository, tests, logs or issues. Use synthetic fixtures.
- Keep astronomical algorithms in VirgoStars-Ephemeris Rust; keep astrological methods in astrological-functions; render only through astrological-charts and approved assets. Do not claim incomplete upstream integrations are working.
- App authentication is not authorization: each server API enforces ownership; local offline access is limited to data previously downloaded for that profile. Never embed a privileged backend secret.
- The app must stay usable offline after a successful prior sign-in, subject to documented local-device security and revocation limits. Never require a continuous network connection to view cached charts.
- All mutations require deterministic IDs, local transactionality and conflict-safe sync. Never silently overwrite an unrelated remote change.
- Update binaries only after cryptographic signature validation. Never commit update signing private keys.
- Keep Windows and macOS considerations in every core API. Windows-only release first; no forced Windows dependencies in the shared core.
- No GitHub Actions, automatic deployment, publication, releases or main merges without explicit maintainer authorization.

## Incremental development
1. Choose one small vertical slice with a testable outcome.
2. Open/reuse a feature branch; draft PR. Document impact on architecture, privacy, auth, sync, releases and licensing.
3. Test what can actually be run locally; say explicitly when tests/builds were not executed.
4. Prefer dependency-injected ports/adapters: `EphemerisProvider`, `AstrologyEngine`, `LocalRepository`, `CloudSyncClient`, `SecureStorage`.
5. Handle migrations, rollback, expired credentials, offline startup, corrupt DB, sync conflicts and update failures as first-class cases.
6. Use synthetic birth data and mocked remote services. Keep fixtures visibly fictional.
7. Report changed files, checks, outstanding risks and next safe step. Do not report plans as implementations.

## Easy onboarding for contributors
The eventual repository should provide a Windows one-command bootstrap script and `npm run dev` with a synthetic/offline demo that does not need a VirgoStars account, any private upstream repository or a production database. Document required Node LTS, Rust toolchain, C++ Build Tools, WebView2 and commands in `docs/CONTRIBUTING.md` once code exists. This is a design requirement, not an available script yet.

## Status language
Use **Proposed**, **Designed**, **Prototype**, **Locally tested**, **Integrated**, **Released** consistently. At present, the project remains **Prototype source / unverified Windows build**. The desktop-owned Angular shell and Tauri demo code are not validated on real Windows WebView2 yet. No released or production-ready application exists.
