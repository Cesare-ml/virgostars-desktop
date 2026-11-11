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
8. [Windows Build Gate](docs/WINDOWS_BUILD_GATE.md): run the read-only doctor before attempting a native build, and report exact failures without logging credentials or absolute user paths.
9. [Render lifecycle](docs/RENDER_LIFECYCLE.md): guard async UI completion from stale redraws and destruction; the upstream Charts renderer still owns WebGL lifecycle.
10. [Windows first GUI smoke](docs/WINDOWS_GUI_SMOKE_2026-11-10.md): a native .exe launched but CSS appeared missing. Verify compiled CSS references and WebView2 loading before changing layout or CSP; never disable security policies as a workaround.
11. [WebView2 style diagnostic](docs/WEBVIEW2_STYLE_DIAGNOSTIC.md): keep CSS marker checks local, read-only and accessible, with no remote fallback; report actual native status before changing CSP.
12. [Angular critical CSS and Tauri CSP](docs/ANGULAR_CSP_CSS_FIX.md): keep `optimization.styles.inlineCritical=false` and reject deferred `media=print`/inline event-handler CSS. Do not weaken native CSP or introduce remote CSS to mask an unstyled window.

## Authoritative product priority: guest-first offline (approved 2026-11-11)

Read **[Offline MVP](docs/OFFLINE_FIRST_MVP.md)**, **[Live Angular–Rust Pipeline](docs/LIVE_CALCULATION_PIPELINE.md)**, **[Offline Places and Timezones](docs/OFFLINE_PLACES_AND_TIMEZONES.md)**, **[Optional Sync/Duplicates](docs/OPTIONAL_SYNC_AND_DUPLICATES.md)**, **[Agent Task Order](docs/MVP_AGENT_TASKS.md)** and [Roadmap](docs/ROADMAP.md) before starting new development.

- **Never require a VirgoStars login, activation, server session or Internet connection** to open the app, calculate real offline sky, choose cities, create/edit/save/search/reopen charts, configure settings or export. The login is optional **after** these guest features work. This supersedes old docs that mandated a first online activation.
- **Priority work sequence:** Windows styled chart-first shell; bounded low-latency IPC/worker and local ephemerides; Adesso clock/live correction/hold; versioned offline cities + historical timezones; local archive/new chart; transits, bodies/aspects/orbs/house systems and Light/Dark; only then optional account sync.
- **Fast interaction must not become unbounded native requests.** Require coalescing, latest-only results, cancellation/queue capacity, stable WebGL scene and memory benchmarks; separate display frame rate from solver evaluations and never fabricate positions.
- **Historical private frontend is a behavior reference only.** Do not copy any branding, credentials, unreviewed assets, source code or third-party astronomy runtime into VirgoStars Desktop. Do not mention legacy product branding in VirgoStars documentation, UI or release artifacts.
- **Duplicate matching is not name matching.** First optional cloud attachment previews remote/local data; user chooses keep local, cloud, both, or explicit merge. Default preserves data; local IDs survive connection.
- **Offline city lookup is mandatory:** keep a versioned licensed catalog and accurate historical IANA timezone behavior, optional online enrichment only, never implicit precise geolocation.
- **Licensed city-data boundary (2026-11-11):** the purchased 1,951,599-city catalog is to be converted **locally** into a read-only SQLite/FTS5 resource, not committed to Git, dumped to PR comments or embedded in Angular/Three.js. Follow [LOCAL_CITY_PACKAGING.md](docs/LOCAL_CITY_PACKAGING.md) and use only synthetic records in tests. The exact data asset and eventual installer need license, checksum, size and Windows-native runtime verification; never claim the current demo already supports city search. Keep the normal synthetic build working without the purchased pack; use the validated Tauri --config overlay only when packaging a real bundle.
- **Native search bridge (2026-11-11):** [NATIVE_OFFLINE_PLACES.md](docs/NATIVE_OFFLINE_PLACES.md) defines a bounded read-only SQLite/Tauri search command, fixed resource path, stable error codes, versioned result DTO and stale-result rejection. Never expose a user-supplied SQL/path parameter, unbounded native invoke loop or a catalog fallback that requires Internet/account. Full 1,951,599-row data and country lookup remain separate from source; Windows Rust/Angular integration is not yet validated.
- **Privacy:** natal names/dates/places/notes are personal data. Prefer SQLCipher with a device-local key not tied to cloud. For initial experiments, plaintext stores only **synthetic fixtures** without an explicit separate security review.
- **Feature scope:** honor the complete specialist catalog and complete house-systems roadmap in [PR #6](https://github.com/Cesare-ml/virgostars-desktop/pull/6) when integrated, including standalone Egyptian and explicit exclusion of Egyptian+Placidus. Unsupported systems must be disabled, not silently remapped. No specialist feature displaces core guest/offline work.
- **Agent work planning:** use [MVP_AGENT_TASKS.md](docs/MVP_AGENT_TASKS.md), choose one atomic validated slice, avoid duplicate stacked PRs and reconcile existing PR #2/#6/#7/#13/#18 and the isolated storage chain before integration.

## Non-negotiable boundaries
- The private repository is **not** presently open source. No LICENSE has been selected. Do not infer a license from dependencies or copy a LICENSE from another repository without approval.
- Never modify VirgoStars production, migrations, user accounts, Astrolabio installations, AWS, DNS, release endpoints or other repositories as a side effect. Cross-repo changes require a separate authorized task.
- Never copy private user birth records, tokens, passwords, production DB dumps, API secrets, keys or unapproved original assets into this repository, tests, logs or issues. Use synthetic fixtures.
- Keep astronomical algorithms in VirgoStars-Ephemeris Rust; keep astrological methods in astrological-functions; render only through astrological-charts and approved assets. Do not claim incomplete upstream integrations are working.
- Optional online authentication is not server authorization: **each cloud API** must enforce the account owner's rights. Guest local data never require a prior download or server permission. Never embed a privileged backend secret.
- The app must start and save charts **offline from first launch without sign-in**. After optional linking, cloud records cached with permission and guest/local records continue to work offline; revocation affects future online sync, not magical immediate deletion of an offline copy.
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
Use **Proposed**, **Designed**, **Prototype**, **Locally tested**, **Integrated**, **Released** consistently. At present the project remains **Prototype / native Windows smoke confirmed but visual acceptance pending**. An experimental Tauri .exe launched with synthetic chart and read-only IPC; native styling and real offline computations have not been accepted. No released or production-ready application exists.
