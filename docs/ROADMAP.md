# VirgoStars Desktop — staged roadmap

Status: **PROPOSED**. This is an ordered work plan, NOT a list of completed features.

## Gate 0 — Documentation and safe workspace
- [x] Create private repository and initial README.
- [x] Draft stack ADR, architecture, auth/sync/privacy, update, licensing and agent guidance (draft PR, not assumed merged).
- [ ] Select the first beta subset from the **full approved end-state catalog** in [FEATURE_CATALOG.md](FEATURE_CATALOG.md); decide supported Windows versions, license and publication conditions separately. The catalog is a commitment to planned final scope, not v1 availability.
- [ ] Create minimal local developer quickstart with synthetic-only fixtures and pinned tool versions.

## Gate 1 — Tauri/Angular proof of concept (no real accounts)
- [ ] Bootstrap Tauri 2 + Angular strict TypeScript + Rust, runnable on Windows.
- [ ] Synthetic UI shell, tabbed chart workspace, keyboard-accessible navigation and settings.
- [ ] Use genuine astrological-charts Three.js renderer on synthetic assets; test WebView2/WebGL, PNG output and context loss.
- [ ] Rust IPC typed request/response fixture with deterministic astronomy result; no full-accuracy claims.
- [ ] Confirm Tauri choice or record a measured Electron fallback; Windows installer smoke test.

## Gate 2 — Local-first storage/offline
- [ ] Choose and prove encrypted SQLite storage + OS secure storage, migrations and account isolation.
- [ ] Model synthetic subjects, charts, favorites/notes and durable outbox.
- [ ] Simulate offline startup, offline edits, crashes and interrupted sync.
- [ ] Local export backup/restore and permanent data deletion policy.

## Gate 3 — Astronomical/astrological libraries
- [ ] Establish versioned Rust EphemerisProvider boundary; do not duplicate astronomical algorithms.
- [ ] Integrate supported astrological-functions operations with numerical regression tests.
- [ ] Integrate approved/redistributable assets only after rights review.
- [ ] Implement/test the complete [HOUSE_SYSTEMS.md](HOUSE_SYSTEMS.md) matrix in the Rust provider: standalone Egizia plus Swiss-compatible systems (including 36 Gauquelin sectors and Sunshine variants), excluding Egizia + Placido; explicit errors for unsupported cases and no silent fallback.
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
- [ ] Verify first Windows beta subset against feature IDs in [FEATURE_CATALOG.md](FEATURE_CATALOG.md), with unsupported planned functions clearly disabled/hidden.
- [ ] License and data/asset publication gates; beta release explicitly approved.

## Gate 6 — macOS and professional tools
- [ ] Mac-native build, Apple Silicon + Intel WebKit/graphics/credential tests.
- [ ] Apple code signing/notarization and signed update.
- [ ] Implement remaining modules from [FEATURE_CATALOG.md](FEATURE_CATALOG.md): sophisticated transits/synods/ingresses, all traditional techniques, predictive methods, ephemerides and advanced chart workspaces with a measured feature-by-feature acceptance matrix.
- [ ] Integrate fixed-star interpretation links per [FIXED_STARS_INTEGRATION.md](FIXED_STARS_INTEGRATION.md); do not replicate web interpretation content.
- [ ] Compare/save chart workspaces, multimonitor, advanced search, event index, controlled Python scripting/export.
- [ ] Expand tests and translation/localization based on needs.

## Initial issues to open
1. Decide architecture POC acceptance matrix and supported Windows releases.
2. Define local encrypted SQLite storage strategy and local profile unlock policy.
3. Formalize backend entity inventory / v1 owner-safe sync API (in separate backend repo).
4. Inventory Three.js assets/rights and isolated renderer adapter for Tauri.
5. Design license choice and release provenance/NOTICE review.

## Definition of done for each PR
Reproducible change, synthetic tests where meaningful, docs updated, security/rights impact discussed, no invented scientific accuracy, no production or deployments, no automatic GitHub Actions, no merge without review/authorization.

## Functional rollout rule (approved scope, implementation pending)

All requirements F01–F08 in [FEATURE_CATALOG.md](FEATURE_CATALOG.md) are **planned for VirgoStars Desktop**, not merely candidate ideas. Exclusions are explicit and binding. Ship incrementally according to upstream readiness, risk and user value; release gate subsets can be smaller, but no accepted item disappears from the long-term backlog without a new documented owner decision. Track each feature ID as **planned → specified → provider validated → UI integrated → offline/sync tested → released**. The menus and naming must not mirror commented or disabled prototype-only features.

The standalone **Egizia** method and full Swiss-compatible house catalog are mandatory long-term targets. The interpretation database for fixed stars remains authoritative on the VirgoStars website, reached via a safe, canonical link from the desktop.
