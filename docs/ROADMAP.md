# VirgoStars Desktop — staged roadmap

Status: **PROPOSED**. This is an ordered work plan, NOT a list of completed features.

## Gate 0 — Documentation and safe workspace
- [x] Create private repository and initial README.
- [x] Draft stack ADR, architecture, auth/sync/privacy, update, licensing and agent guidance (draft PR, not assumed merged).
- [x] Select CPAL-1.0 for original desktop source, with completed attribution exhibits and NOTICE.
- [ ] Complete the public-release rights/history scan, relocate the protected city-catalog release asset, and approve any visibility change separately.
- [ ] Decide v1 scope and Windows support versions.
- [ ] Create minimal local developer quickstart with synthetic-only fixtures and pinned tool versions.

## Gate 1 — Tauri/Angular proof of concept (no real accounts)
- [ ] Bootstrap Tauri 2 + desktop-owned Angular strict TypeScript + Rust, runnable on Windows. **Partial:** a Tauri 2 Rust host of the upstream Angular charts demo is in a stacked experimental PR; Windows compilation not yet tested.
- [ ] Desktop-owned Angular shell visually verified on Windows. **Partial:** the maintainer built and launched an experimental Tauri .exe; Angular, read-only Rust IPC and a small synthetic chart appear, but the native window is almost entirely unstyled. CSS-load diagnosis and visual QA are still required. Async rendering generation-guard unit tests previously passed.
- [ ] Use genuine astrological-charts Three.js renderer on synthetic assets; test WebView2/WebGL, PNG output and context loss. **Partial:** Angular desktop source imports the renderer; the new synthetic-only staging and post-build bundle verifier have passing isolated Node tests. WebView2 rendering and export remain untested.
- [ ] Rust IPC and independently validated astronomy integration. **Partial:** versioned read-only runtime-capability command registered in Rust and consumed by the Angular shell; Node contract tests and Rust unit tests added, native build/IPC still unverified. **No astronomical computation** is provided by the runtime probe.
- [ ] Confirm Tauri choice or record a measured Electron fallback; Windows installer smoke test. **Partial:** read-only setup/build/verify doctor and revised Windows bootstrap written with local Node tests; Windows MSVC/WebView2 and actual executable remain unverified.

## Gate 2 — Local-first storage/offline
- [ ] Choose and prove encrypted SQLite storage + OS secure storage, migrations and account isolation.
- [ ] Model synthetic subjects, charts, favorites/notes and durable outbox. **Partial (prototype, 2026-11-15):** saved chart inputs persist in an **encrypted** archive ([Encrypted archive](ENCRYPTED_ARCHIVE.md); XChaCha20-Poly1305, key in the OS credential store, staged migration of the old plain file, fail-closed) with versioned schema, transactional saves and fail-closed handling of damaged or newer files. Not security-reviewed; no recovery key, profiles, groups, notes or outbox yet.
- [ ] Simulate offline startup, offline edits, crashes and interrupted sync.
- [ ] Local export backup/restore and permanent data deletion policy.

## Gate 3 — Astronomical/astrological libraries
- [ ] Establish versioned Rust EphemerisProvider boundary; do not duplicate astronomical algorithms. **Partial (prototype, 2026-11-15):** `calculate_chart` v1 and the provider trait exist with Rust and Node tests. **Update 2026-11-17:** the canonical VirgoStars-Ephemeris adapter replaced the temporary Swiss adapter and was compared numerically with it ([details](VIRGOSTARS_EPHEMERIS_PROVIDER.md)); the Swiss feature is gone from the build. Data distribution and the installer remain open.
- [ ] Integrate supported astrological-functions operations with numerical regression tests. **Partial (prototype):** sign index, dodecatemoria and house placement are used through a sibling `file:` dependency. The natal wheel also offers [dodecatemoria, antiscia and contra-antiscia](ZODIAC_PROJECTIONS.md), Regolo decans, decades, elemental terms and planet of the year. Solar and lunar returns ([Returns](RETURNS.md)) are searched in the Rust host on top of the provider. Natal and cross-chart aspect tables use its angular arithmetic, with pairing rules still in the desktop ([Aspects and orbs](ASPECTS_AND_ORBS.md)). Lots and methods listed as planned in `src/app/function-catalog.ts` are not integrated; cross-chart tables are not validated against renderer lines.
- [ ] Integrate approved/redistributable assets only after rights review.
- [ ] Explicitly mark unavailable bodies, houses, time ranges and precision; no silent fallback.
- [ ] Fixed stars: the ordinary chart can request a local catalogue and show experimental contacts on the wheel; approximate entries are marked. The separately supplied 738-entry catalogue may be embedded for a private build, subject to its rights and validation limitations. See [fixed stars](FIXED_STARS.md).
- [ ] Extended-date chart mode: the owner subsequently requested dates beyond the ordinary 1900–2033 civil-time range. The new-chart form exposes the existing explicit calendar, local-clock and ΔT choices. On 2026-11-19 an isolated Windows installer test downloaded DE441 data from GitHub, calculated and saved fictional charts for 900 Julian and 2300 proleptic Gregorian, and found them in the archive after restart. The older-version upgrade test used an isolated application identity and archive key. These checks do not establish astronomical precision for all dates; the UTC-based navigator does not yet handle historical dates. See [provider](VIRGOSTARS_EPHEMERIS_PROVIDER.md).
- [ ] Optional independent event dataset/index after VirgoStars-Event-Ephemeris becomes valid and distributable.
- [ ] **DE441 package delivery (new 2026-11-19 plan):** private installer staging default 1000–2200 with a fail-closed v2 manifest is being prepared; unbuilt/untested. Integrate the upstream contiguous catalog, verified HTTPS downloads and resumable atomic install, user-selectable first-run extension, Settings status/expansion/removal only at the edges, app-update persistence, legal/source review and Windows offline/failure QA. No public DE441 release or live downloader exists yet.

## Cielo 3D — observer dome (prototype in feature branch, 2026-11-20)

- [ ] Validate the initial interactive Three.js observer sky on Windows/WebView2 with real DE441: topocentric geometric planet positions, existing fixed stars, true-N/E/S/W horizon, meridian, equatorial grid and selection. See [Cielo 3D plan](SKY_3D_OBSERVER_MVP_2026-11-20.md). Code is not evidence of native QA or scientific acceptance.
- [ ] Add ephemeris-native equatorial-to-horizontal API independent from house-system availability, observer elevation, refraction, historical/ΔT treatment and trusted stellar catalogue.
- [x] **Code in draft PR #390 (not yet validated/released):** true tropical ecliptic with 12×30° arcs, original zodiac glyphs, computed ASC/DSC/MC/IC markers and dedicated visibility controls.
- [ ] Geometrically correct house boundaries for each system, not just cusp degrees; see [3D houses and primary directions RFC](SKY_3D_HOUSES_PRIMARY_DIRECTIONS_RFC.md).
- [ ] **True primary directions (distinct from SIMPLIFIED_PRIMARY):** decide classical methodology, direct/converse/semiárches and time keys, implement independently validated engine output, render geometric arcs on the natal sphere with provenance and numerical audit.

## Gate 4 — Production-safe cloud auth and sync (separate backend work required)
- [ ] Approve device auth/login in system browser and PKCE; secure refresh handling.
- [ ] Backend contract design: per-owner access, registration/revocation, idempotent changes, revisions/cursors, paging.
- [ ] Create staging-only API fixture tests and backend migrations separately, with backup/rollback.
- [ ] End-to-end sync with two devices, conflicts, expired credentials, offline usage and user-scoped data.
- [ ] Explicit test and approval before touching production.

## Gate 5 — Signed Windows beta
- [ ] Manual reproducible release workflow; signed updater and installer.
- [ ] Threat model, encryption/key rotation review and data migration recovery drill.
- [ ] Real chart export, accessibility, error handling, performance and reliability tests.
- [ ] License and data/asset publication gates; beta release explicitly approved.

## Gate 6 — macOS and professional tools
- [ ] Mac-native build, Apple Silicon + Intel WebKit/graphics/credential tests.
- [ ] Apple code signing/notarization and signed update.
- [ ] Compare/save chart workspaces, multimonitor, advanced search, synods/event index, controlled Python scripting/export.
- [ ] Expand tests and translation/localization based on needs.

## Initial issues to open
1. Decide architecture POC acceptance matrix and supported Windows releases.
2. Define local encrypted SQLite storage strategy and local profile unlock policy.
3. Formalize backend entity inventory / v1 owner-safe sync API (in separate backend repo).
4. Inventory Three.js assets/rights and isolated renderer adapter for Tauri.
5. Design license choice and release provenance/NOTICE review.

## Definition of done for each PR
Reproducible change, synthetic tests where meaningful, docs updated, security/rights impact discussed, no invented scientific accuracy, no production or deployments, no automatic GitHub Actions, no merge without review/authorization.

## Local verification checkpoint — 2026-11-17

On Windows, `npm run check` passed: 813 Node tests passed, 12 were skipped, the native IPC inventory check passed, and the synthetic Angular bundle and its offline/privacy gates passed. Stale source-contract tests were reconciled with the existing guarded clock, delegated Windows launcher, build preflights and stylesheet allowlist. These checks do not establish native WebView2 behavior, a Rust/Tauri build, scientific accuracy, or release readiness.

Follow-up on the same Windows checkout: `cargo test --locked --offline` passed 34 Rust unit tests with default features; `CARGO_NET_OFFLINE=true` and `npm exec --offline -- tauri build --no-bundle` compiled a local release-mode executable from the verified synthetic UI. The strict verification doctor and Windows PE header check passed. This build has no optional Swiss provider, installer or signature. The executable was not launched in this verification; WebView2, offline operation and astronomical accuracy remain unverified.
