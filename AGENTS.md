# AI and human contributor instructions — VirgoStars Desktop

**Scope:** experimental desktop client being prepared for a public open-source source release. These instructions apply to all contributors.

## Read before any change
1. `README.md`; `docs/ADR-0001-TECH-STACK.md`; `docs/ARCHITECTURE.md`.
2. `docs/OFFLINE_AUTH_AND_SYNC.md`; `docs/SECURITY_AND_PRIVACY.md`; `docs/ROADMAP.md`.
3. `docs/LICENSING_AND_PUBLICATION.md` and `docs/PUBLICATION_CHECKLIST.md`; applicable publicly available upstream `AGENTS.md` and package contracts.
4. Existing issues, draft PRs and recent commits, including UI guidelines in separate design PR #2. Avoid conflicts or duplicate work.
5. [Shell 001](docs/SHELL-001.md) for the Angular UI prototype and safe build prerequisites.
6. [Offline asset pipeline](docs/ASSET_PIPELINE.md) before modifying Angular asset handling; the synthetic manifest is not permission to redistribute original art.
7. [Native runtime bridge](docs/NATIVE_RUNTIME_BRIDGE.md) before adding Tauri IPC. The v1 command is read-only; never re-purpose it for login or astronomical calculations.
8. [Windows Build Gate](docs/WINDOWS_BUILD_GATE.md): run the read-only doctor before attempting a native build, and report exact failures without logging credentials or absolute user paths.
9. [Render lifecycle](docs/RENDER_LIFECYCLE.md): guard async UI completion from stale redraws and destruction; the upstream Charts renderer still owns WebGL lifecycle.
10. [Windows first GUI smoke](docs/WINDOWS_GUI_SMOKE_2026-11-10.md): a native .exe launched but CSS appeared missing. Verify compiled CSS references and WebView2 loading before changing layout or CSP; never disable security policies as a workaround.

## Non-negotiable boundaries
- The project's original source is licensed under **CPAL-1.0**, with VirgoStars attribution specified in `LICENSE` Exhibit B and `NOTICE`. This does not license third-party artwork, fonts, proprietary city datasets, private-service code, or externally obtained ephemeris kernels. Follow `docs/LICENSING_AND_PUBLICATION.md`.
- Never modify VirgoStars production, migrations, user accounts, Astrolabio installations, AWS, DNS, release endpoints or other repositories as a side effect. Cross-repo changes require a separate authorized task.
- Never copy private user birth records, tokens, passwords, production DB dumps, API secrets, keys or unapproved original assets into this repository, tests, logs or issues. Use synthetic fixtures.
- Keep astronomical algorithms in VirgoStars-Ephemeris Rust; keep astrological methods in astrological-functions; render only through astrological-charts and approved assets. Do not claim incomplete upstream integrations are working.
- App authentication is not authorization: each server API enforces ownership; local offline access is limited to data previously downloaded for that profile. Never embed a privileged backend secret.
- The app must stay usable offline after a successful prior sign-in, subject to documented local-device security and revocation limits. Never require a continuous network connection to view cached charts.
- All mutations require deterministic IDs, local transactionality and conflict-safe sync. Never silently overwrite an unrelated remote change.
- Update binaries only after cryptographic signature validation. Never commit update signing private keys.
- Keep Windows and macOS considerations in every core API. Windows-only release first; no forced Windows dependencies in the shared core.
- Planet, celestial-point and zodiac-sign glyphs in the desktop must use the approved `astrological-assets` pack; do not substitute Unicode or font glyphs. If artwork is unavailable, use an accessible textual name rather than an invented glyph.
- The maintainer explicitly authorized only the **manual** macOS DMG build workflow (`.github/workflows/build-macos.yml`, `workflow_dispatch`, read-only, unsigned artifacts). Do not add automatic GitHub Actions triggers, deployments, public visibility changes, releases or main merges without explicit maintainer authorization. Keep protected datasets and credentials out of builds and logs.

## Incremental development
1. Choose one small vertical slice with a testable outcome.
2. Open/reuse a feature branch; draft PR. Document impact on architecture, privacy, auth, sync, releases and licensing.
3. Test what can actually be run locally; say explicitly when tests/builds were not executed.
4. Prefer dependency-injected ports/adapters: `EphemerisProvider`, `AstrologyEngine`, `LocalRepository`, `CloudSyncClient`, `SecureStorage`.
5. Handle migrations, rollback, expired credentials, offline startup, corrupt DB, sync conflicts and update failures as first-class cases.
6. Use synthetic birth data and mocked remote services. Keep fixtures visibly fictional.
7. Report changed files, checks, outstanding risks and next safe step. Do not report plans as implementations.

## Easy onboarding for contributors
The public-source build must remain possible with synthetic fixtures, the publicly available Charts library checkout, and no private upstream checkout, production account, database or credential. Use the commands in `README.md` and `docs/CONTRIBUTING.md`; do not claim that a one-command bootstrap or release installer already exists.

## Status language
Use **Proposed**, **Designed**, **Prototype**, **Locally tested**, **Integrated**, **Released** consistently. The repository currently contains an experimental Angular/Tauri prototype and documented synthetic tests. A Windows native smoke build has been reported, but complete release acceptance, real astronomy integration and public-installation validation remain open. No production-ready application exists.
