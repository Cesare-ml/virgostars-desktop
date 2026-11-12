# VirgoStars Desktop

**Private experimental repository — future free/open-source desktop application for astrologers and astrology researchers.**

VirgoStars Desktop will provide an offline-first professional workstation for Windows, with macOS support planned, powered by the independent VirgoStars astronomy, astrology and graphics libraries. No VirgoStars account or Internet connection is required to start, calculate, save and manage local natal charts. Users may later sign in voluntarily to synchronize their local archive with their VirgoStars account, with explicit duplicate/conflict review.

## Synthetic native Rust calculation probe (testing only)

A separate [bounded synthetic Tauri IPC probe](docs/SYNTHETIC_NATIVE_CALCULATION_PROBE.md) now exercises a fixed-size CPU workload with a strict two-worker gate and `syntheticOnly` response marker. The TypeScript transport passed eight isolated behavioral tests. A [development-only Settings benchmark](docs/DEVELOPMENT_IPC_BENCHMARK.md) now runs a bounded 24-call sequence and reports p50/p95/p99 **when actually executed on the Windows dev app**; 8/8 isolated benchmark tests passed. Rust rejects the synthetic endpoint in release builds. **Rust compilation, actual WebView2 IPC latency and real ephemeris calculations remain unverified and disconnected from the chart.**

## Bounded future Rust calculation requests

A pure [latest-only calculation scheduler](docs/LATEST_CALCULATION_SCHEDULER.md) now accepts rapid synthetic requests while maintaining **one active and one latest pending**, suppressing obsolete results/errors. 10/10 isolated Node tests passed, including a 10,000-submission overload; **no Rust astronomy or chart animation is connected yet**.

## Rapid natal time correction (prototype)

Five plus/minus controls for year, month, day, hour and minute now support **press-and-hold**, calendar rollover and invalid-date/unknown-time protection entirely in the unsaved Angular draft. The local time preview is invalidated after every change. **Actual natal chart animation and Rust ephemeris requests are not wired yet.** See [rapid time correction](docs/NATAL_RAPID_CORRECTION.md).

## New natal chart input (experimental, unsaved)

A guest-only **New natal chart / Nuovo tema** form now accepts a subject name, Gregorian birth date, optional known time and an offline selected city, including original location ID, coordinates, country and IANA-style timezone. A typed validation preview explicitly warns that **UTC/historical DST, true sky calculation and encrypted saving are NOT implemented**. This form stores nothing and does not alter the synthetic chart. See [Natal Draft v1](docs/NATAL_DRAFT_V1.md).

A **provisional offline UTC preview** now reports normal IANA conversion, DST gaps (invalid local hour), and folds (explicit choice between two UTC instants), with the bundled timezone-data version and historical warnings. It **does not save records or calculate a real chart**. See [Natal Timezone Resolution](docs/NATAL_TIMEZONE_RESOLUTION.md).

## Source country labels for offline city results

The city source has `stato_id` as an internal foreign key; **country labels must be imported from the owner's actual related lookup table**, not inferred. An optional `--countries-csv` now produces an enriched v2 SQLite resource with validated name/ISO2, while v1 remains readable. See [Country Lookup](docs/OWNED_COUNTRY_LOOKUP.md). The purchased country data are **not in GitHub**, and full native search/installer validation is pending.

## Preparing the complete offline city catalog

The purchased **1,951,599-city** reference database is intended to ship with the Windows installer after a private, validated PostgreSQL CSV → SQLite conversion.

A **new Rust local search command** reads indexed SQLite with at most two concurrent blocking workers and max 30 results; a strict TypeScript adapter validates responses and drops stale searches. See [Native Offline Places](docs/NATIVE_OFFLINE_PLACES.md). This code is authored but not yet verified in the Windows executable. The Angular Settings/Parametri panel now contains a debounced offline city autocomplete; its **10 pure state tests passed locally**, but UI/native full-catalog QA remains pending. Selecting a city does not yet alter synthetic sky positions or create a saved chart. **The actual licensed city data are never committed to Git.** A batch Python converter, checksum/ZIP generator and Tauri resource-config helper are now in source control. They do **not** yet implement Rust-backed city search or the Angular city selector. See [Local City Packaging](docs/LOCAL_CITY_PACKAGING.md) for safe export, validation, Windows commands and GitHub Release asset distribution.

## Offline-first product decision (2026-11-11)

**First useful goal:** open VirgoStars Desktop without registration, choose a city from a local offline catalog, show a verified current-sky chart with real-time clock, create/save/search/edit local natal charts, correct year/month/day/hour/minute fluidly by rapid click/hold, inspect selected-chart transits, and configure house systems, bodies, aspects, per-body/per-aspect orbs, graphical layers and Light/Dark skins. Online account login is optional and comes later, with no-loss duplicate reconciliation.

**Priority specs:** [Offline MVP](docs/OFFLINE_FIRST_MVP.md) · [Low-latency Angular↔Rust pipeline](docs/LIVE_CALCULATION_PIPELINE.md) · [Offline cities and tzdb](docs/OFFLINE_PLACES_AND_TIMEZONES.md) · [Optional sync and duplicates](docs/OPTIONAL_SYNC_AND_DUPLICATES.md) · [Agent task order](docs/MVP_AGENT_TASKS.md) · [Roadmap](docs/ROADMAP.md). These are requirements, **not features implemented by the current synthetic .exe**.

## Current state (2026-11-10)

**Windows first launch (maintainer smoke test):** an experimental Tauri `.exe` has been built and opened on Windows 11, Angular renders synthetic chart data, and the local native runtime probe responds. **The visual interface is still substantially unstyled with a tiny chart.** This is NOT yet a usable beta. See [Windows GUI Smoke](docs/WINDOWS_GUI_SMOKE_2026-11-10.md) for CSS triage and the new `npm run verify:css` build-artifact check.


- **Experimental desktop-owned Angular shell:** source now contains an Angular 20 application with a real astrological-charts renderer adapter, chart-first layout, collapsible navigation/inspector, light/dark themes, IT/EN labels, responsive sizing and PNG export paths. Synthetic assets are staged for Tauri 2 offline testing. **A Windows synthetic .exe has launched, but the native visual CSS remains unverified after the fix**; account login, sync, SQLite and real astronomy integration do not exist. See [Shell 001](docs/SHELL-001.md), [Spike 001](docs/SPIKE-001.md), [Native Runtime Bridge](docs/NATIVE_RUNTIME_BRIDGE.md) and [Windows Build Gate](docs/WINDOWS_BUILD_GATE.md).
- **Proposed stack:** Tauri 2, Angular/TypeScript, Rust and a local SQLite database, subject to an architecture spike.
- **Windows first, macOS later:** no Windows-specific application logic in cross-platform modules.
- **Private for now.** The future open-source license is **not yet decided**. Do **not** add a LICENSE file, claim that code is CPAL/MIT licensed or publish this repository without an explicit decision.
- No access to live production accounts, birth data, credentials, databases, or AWS is granted by this repository.
- No automatic GitHub Actions, deploys, releases, or production changes.

## Proposed dependency boundaries

- [VirgoStars-Ephemeris](https://github.com/Cesare-ml/VirgoStars-Ephemeris): original Rust astronomy engine; experimental and not yet shipping-ready.
- [astrological-functions](https://github.com/Cesare-ml/astrological-functions): astrology/domain functions; still experimental.
- [astrological-charts](https://github.com/Cesare-ml/astrological-charts): Angular/Three.js chart renderer; visual/parity gates remain.
- [astrological-assets](https://github.com/Cesare-ml/astrological-assets): separately licensed/approved artwork; private and **not approved for automatic public redistribution**.
- [VirgoStars-Event-Ephemeris](https://github.com/Cesare-ml/VirgoStars-Event-Ephemeris): proposed compressed event data and index reader, not yet an integrated runtime.
- [VirgoStars web/backend](https://github.com/Cesare-ml/virgo-stars): current user accounts and records; production-safe synchronization requires new versioned API contracts.

**Never copy credentials, private application source or users' data into this repository.** Experimental packages must not be described as validated astronomical computation or production integrations.

## Contribution workflow

Work in dedicated branches and pull requests. Read `AGENTS.md` before touching the repository once it is introduced. Keep architecture decisions, offline/privacy invariants, and tests with each code change. No production migrations, deploys, automatic Actions, app store releases, public visibility changes or LICENSE selection without maintainer approval.

## Windows CSS fix candidate (Angular critical CSS)

The first Windows `.exe` proved Angular, Rust IPC and synthetic Three.js rendering, but appeared unstyled. Angular's default production critical-CSS optimization can defer CSS using `media="print"` and an inline `onload` event handler that Tauri's restrictive CSP may block. The desktop Angular production builder now disables `inlineCritical` without relaxing CSP. The offline bundle verifier rejects that deferred pattern. **This is a source fix whose native visual result still needs Windows validation.** See [Angular CSP CSS Fix](docs/ANGULAR_CSP_CSS_FIX.md).

## Diagnosing unstyled WebView2 windows

The synthetic Desktop shell can now inspect global/component CSS markers and chart geometry inside the running app. Its footer reports a local CSS health status and an accessible recheck control. The optional post-build `npm run verify:css` checks compiled assets only; **neither check is proof of visual quality until tested on Windows**. See [WebView2 Style Diagnostic](docs/WEBVIEW2_STYLE_DIAGNOSTIC.md).

## Renderer lifecycle safety

The Angular demo protects its rendering state against out-of-order async scene completions and window teardown. See [Render Lifecycle](docs/RENDER_LIFECYCLE.md); **real WebView2 behavior still requires Windows verification**.

## Quick read-only setup check

Run `node scripts/desktop-doctor.mjs` or `npm run doctor` on Windows to diagnose Node, Rust MSVC, WebView2, upstream Charts and Angular/Tauri build prerequisites. `npm run doctor:json` produces a shareable report with no personal paths. For the complete build attempt, use `scripts\\build-windows.cmd` (no PowerShell policy changes). See [Windows Build Gate](docs/WINDOWS_BUILD_GATE.md). A previous experimental native .exe launched; this does not prove the latest CSS correction, real offline astronomical calculations or end-to-end WebView2 acceptance.

## Current working prototype (stacked draft PR)

The first separate prototype branch adds `src-tauri/`, Node-based synthetic asset staging, offline bundle checks, eight existing Node tests and an unverified follow-up Angular shell. The subsequent asset-pipeline hardening adds an isolated synthetic-only staging process and verifies the Angular bundle without compiling the old charts demo. See [offline asset pipeline](docs/ASSET_PIPELINE.md). This is **not yet an installer or production application**. Clone both authorized private repositories side-by-side and follow [Spike 001](docs/SPIKE-001.md). Neither production VirgoStars nor original artwork is required.

## Planned documentation

The first design pull request introduces architecture, stack decision, offline authentication/sync, security, release/update strategy, roadmap, contributor guidelines and licensing decision log. These are **proposals**, not implemented features.
