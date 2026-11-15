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
- [ ] Model synthetic subjects, charts, favorites/notes and durable outbox.
- [ ] Simulate offline startup, offline edits, crashes and interrupted sync.
- [ ] Local export backup/restore and permanent data deletion policy.

## Gate 3 — Astronomical/astrological libraries
- [ ] Establish versioned Rust EphemerisProvider boundary; do not duplicate astronomical algorithms. **Partial (prototype, 2026-11-15):** `calculate_chart` v1 and the provider trait exist with Rust and Node tests. The only adapter is the optional, local-use-only Swiss Ephemeris feature ([details](SWISS_EPHEMERIS_PROVIDER.md)); the canonical VirgoStars-Ephemeris adapter and numerical comparison against it are still to do.
- [ ] Integrate supported astrological-functions operations with numerical regression tests. **Partial (prototype, 2026-11-15):** sign index, dodecatemoria and house placement are used through a sibling `file:` dependency. Aspects, lots and every method listed as planned in `src/app/function-catalog.ts` are not integrated.
- [ ] Integrate approved/redistributable assets only after rights review.
- [ ] Explicitly mark unavailable bodies, houses, time ranges and precision; no silent fallback.
- [ ] Optional independent event dataset/index after VirgoStars-Event-Ephemeris becomes valid and distributable.

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
