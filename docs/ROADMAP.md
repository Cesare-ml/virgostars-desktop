# VirgoStars Desktop — implementation roadmap

**Product priority updated: 2026-11-11. Status: APPROVED REQUIREMENTS, NOT FINISHED FEATURES.**
**Primary objective:** a genuinely useful **no-account, offline-first** professional natal chart workstation on Windows, then optional VirgoStars cloud login/sync. Previously documented mandatory online activation is **superseded**.

**Reference documents:** [OFFLINE_FIRST_MVP.md](OFFLINE_FIRST_MVP.md) · [LIVE_CALCULATION_PIPELINE.md](LIVE_CALCULATION_PIPELINE.md) · [OFFLINE_PLACES_AND_TIMEZONES.md](OFFLINE_PLACES_AND_TIMEZONES.md) · [OPTIONAL_SYNC_AND_DUPLICATES.md](OPTIONAL_SYNC_AND_DUPLICATES.md) · [MVP_AGENT_TASKS.md](MVP_AGENT_TASKS.md). The full specialist feature catalog / full Swiss-compatible house requirements are in separate [PR #6](https://github.com/Cesare-ml/virgostars-desktop/pull/6); integrate/reconcile later, do not lose its long-term scope.

## Phase 0 — Consolidate the existing native prototype (urgent)

- [x] First Windows 11 experimental `.exe` successfully **launched** by maintainer: Angular shell, synthetic Three.js chart and read-only Tauri/Rust IPC were observable. This is a feasibility milestone, **not** a usable astronomical product.
- [ ] Resolve unstyled/small-chart WebView2 issue; verify Angular CSP-compatible CSS from PR #18 and in-app CSS diagnostic PR #17, with screenshot and no CSP relaxation.
- [ ] Audit and remove generated `dist/` and `.angular/cache/` output accidentally committed to the diverged PR #13 branch **safely**; check asset rights before any re-distribution. Do not delete user workspace content.
- [ ] Reconcile UI accessibility/design PR #7 and approved light/dark visual direction PR #2 with the current Angular shell stack; retain chart-first center and compact navigation.
- [ ] Record Windows native npm/Cargo builds and lockfiles, inspect dependency vulnerabilities and validate packaged local assets; no GitHub Actions or automatic main merge. **Phase-0 stabilization (2026-11-12):** the 18 committed experimental-first-sky decoder tests now pass locally on exact GitHub files; fixed two test-file defects and added a dependency-free `npm run test:syntax` preflight to all Node test suites. This is **not** full-repository, Angular or native Rust validation.

## Phase 1 — Offline live sky & low-latency calculation (first priority)

- [ ] **Bounded, latest-only Angular ↔ Rust calculation pipeline:** [pure TypeScript scheduler](LATEST_CALCULATION_SCHEDULER.md) is implemented with one active/one latest pending synthetic transport (10/10 tests passed, 10k overload submissions). A **separate synthetic-only bounded Tauri worker probe** and [development-only Angular latency panel](DEVELOPMENT_IPC_BENCHMARK.md) are now authored (8/8 local isolated benchmark tests passed, strict TypeScript passed; release Rust command disabled); these do not calculate astronomical positions. Still missing Rust cargo/Windows IPC validation, actual worker cooperative cancellation/deadline, typed astronomy outputs, Rust ephemeris provider and end-to-end WebView2 chart rendering.
- [ ] Integrate a validated offline `VirgoStars-Ephemeris` Rust provider with verified local kernels and explicit supported range. A [fail-closed **experimental** first-sky DTO](FIRST_SKY_EXPERIMENTAL_CONTRACT.md) is now authored in TypeScript, grounded in upstream `first_sky.rs` and preserving real barycenter labels, classic DE441 provenance and model approximations; **it never permits validated natal rendering**. Still missing Rust native adapter, independent numeric reference comparisons, kernel checks, true apparent positions/velocities/houses and renderer integration. Compose aspects via `astrological-functions` and render through `astrological-charts`; no duplicate astronomy, silent fallback or network dependency.
- [ ] Incremental chart rendering / layer updates (reusing WebGL resources), separate immutable radix and changing transit ring, reliable zoom/Fit, hover/click/keyboard planet-aspect selection and active aspect focus.
- [ ] `Adesso` on startup: real local clock (seconds), chosen place, timezone, verified current-sky chart, sensible cadence, explicit refresh/pause/resume and wake-from-sleep handling. Never invent a location.
- [ ] `Correzione tema`: **five year/month/day/hour/minute +/- controls and bounded press-and-hold are now implemented in the unsaved local editor**; leap-day/month/year carry, pointer/keyboard/blur cancellation and unknown-time preservation have isolated Node tests. See [NATAL_RAPID_CORRECTION.md](NATAL_RAPID_CORRECTION.md). **Still required:** real Rust astronomy IPC, sequential chart animation, configurable step sizes, validated native Windows controls, persistent save/reset and end-to-end benchmarks; the current wheel remains synthetic.
- [ ] Benchmark memory/performance on Windows: many rapid events, 60s sustained hold and 30min live; verify finite queues/caches, GPU cleanup and no growing RAM; precise thresholds chosen from measurements.

## Phase 2 — Offline places, charts and archives (parallel with Phase 1)

- [ ] **Package all 1,951,599 purchased cities as a local SQLite/FTS5 catalog**, with private CSV export, strict row-count + SHA-256 manifest checks and a Tauri installer resource. Source converter/config tools are authored; a **bounded read-only Rust Tauri search command** and latest-only TypeScript adapter have now been written in draft code ([native search spec](NATIVE_OFFLINE_PLACES.md)), with synthetic tests authored. Actual native Windows verification, full converted SQLite/ZIP byte size, **country-name v2 mapping support drafted, but awaiting source country table export and native QA**, actual Windows visual verification of the **new Angular city autocomplete**, selected-city persistence in the local guest archive, redistribution evidence and installer QA are **not yet complete**. Angular picker source and pure debounce/selection tests are now implemented (10/10 local Node tests passed). No purchased records in Git. See [LOCAL_CITY_PACKAGING.md](LOCAL_CITY_PACKAGING.md).
- [ ] Ship **authoritative versioned** IANA timezone rules and historical DST validation; a **provisional local DST gap/fold preview** using bundled Moment Timezone data is now authored and 13 synthetic unit tests passed, but needs native/Rust parity and historical review. See [NATAL_TIMEZONE_RESOLUTION.md](NATAL_TIMEZONE_RESOLUTION.md). Never rely on present-day offsets or silently choose an ambiguous natal hour.
- [ ] Guest/local profile **without registration**: a [new natal draft v1](NATAL_DRAFT_V1.md) form is now authored with civil date/time, optional unknown time, selected offline place and validated **in-memory preview only**. **Still to build:** historically accurate tzdb-to-UTC conversion, validated Rust ephemeris calculation, local encrypted Save/edit/open/duplicate/delete, notes/groups, archive search and restart recovery. No personal data are persisted by this form.
- [ ] Select and document local SQLite profile schema, migration and backup. Prefer SQLCipher + OS key for real personal birth data; reuse separately tested Rust prototypes only after validation. Plain SQLite may be used for **synthetic development fixtures**, never as a hidden fallback after an encryption error.
- [ ] Local archive, cities, current sky, time correction and PNG must continue working without network connection, login or a cloud API.

## Phase 3 — Core astrology and settings (P0 scope)

- [ ] Natal radix, selected-natal transits and planet/aspect information. Transits change independently from birth moment; hover natal → transit aspects; hover transit → natal aspects.
- [ ] Settings: skin Light/Dark (and visual element/layer options), supported bodies/points enabled, body participates-in-aspects (`aspetti verso`), per-planet/body orbs, per-aspect enable/orb, angular/chart display options and settings persistence.
- [ ] House-system picker: standalone Egyptian plus **all Swiss-reference-compatible methods that the original Rust engine has actually implemented and numerically validated** (long-term coverage is mandatory). Explicitly **exclude Egyptian + Placidus** and don't silently fall back on errors.
- [ ] Accessible IT/EN UI with centered large chart, keyboard navigation, readable dark/light symbols, clear status and real high-resolution PNG.
- [ ] Validate calculation accuracy and source/precision warnings, cases with unknown birth time, polar limits and legacy reference parity **as test vectors only**.

## Phase 4 — Optional VirgoStars account and safe sync (not needed for P0)

- [ ] System-browser login with PKCE *when user chooses to connect*. Local guest chart and archive continue to work if user declines, disconnects or loses Internet.
- [ ] Inspect server-owned entity schema and contract for owner-scoped CRUD, versions, cursor, device access and mutations; separate approved backend work and migrations. Never assume current production routes exist.
- [ ] On first link: fetch authorized cloud inventory; show preview, possible duplicate candidates and per-record choices **keep local / keep cloud / keep both / explicit merge / skip**. Same name is never proof of identity.
- [ ] Integrate durable idempotent outbox, ACK ledger, optional encrypted SQLite schema migration (PRs #11–#20 are isolated prototypes); atomic import, conflict resolution, crash recovery, stable IDs and explicit pending/synced/error indicators.
- [ ] Offline edits and local access remain available after account disconnect. Support clear backup, ownership and delete/unlink policy without forced upload.

## Phase 5 — Windows beta readiness and distribution

- [ ] Define tested Windows versions, dependency/license/asset attribution, user data privacy policy, compiled ephemeris coverage and acceptable time/place accuracy.
- [ ] Test keyboard/accessibility/contrast, 125/150% DPI, speed and memory on ordinary hardware; compare every supported feature with a reference fixture, especially hold-repeat and timed transits.
- [ ] Real app backup/restore, local schema upgrades, crash recoveries, secure key handling, signed installer/updater and reproducible build gate.
- [ ] Public/open-source license and binary distribution decision explicitly approved. **No automatic GitHub Actions, deploy or publish**.

## Phase 6 — Extended functionality and macOS

- [ ] Preserve the **full** feature catalog in [PR #6](https://github.com/Cesare-ml/virgostars-desktop/pull/6): advanced synods/events, directions, revolutions, traditional techniques, lots, fixed stars and other supported specialized views. Do not mistake commented legacy menus for requirements; follow explicit exclusions.
- [ ] Mac native build, graphics and Keychain tests, sign/notarization; do not make Windows-only assumptions in the shared Rust core.
- [ ] Fixed star interpretation links remain on the VirgoStars website; optional online explanation must not prevent offline positions.
- [ ] Advanced export, multiscreen, future Python adapter and optional event datasets only after stable core operations.

## Status-reporting and agent gates

Track each slice as **required → designed → validated provider → integrated UI → native/offline tested → released**. Update docs and tests in each small PR and report which checks were actually executed. Do not treat mock/demo data, isolated SQLCipher crates, approved scope documents or manual Windows startup as production-ready functionality.

**The priority order is Phase 0 → fast offline Phase 1/2 in parallel → core settings and transits Phase 3 → optional cloud Phase 4.** Long-term scope remains intact; guest/offline core must never regress into account-required.
