# VirgoStars Desktop

**Private experimental repository — future free/open-source desktop application for astrologers and astrology researchers.**

VirgoStars Desktop will provide an offline-first professional workstation for Windows, with macOS support planned, powered by the independent VirgoStars astronomy, astrology and graphics libraries. Users sign in with their VirgoStars account on first activation, then can work offline with previously authorized local data and synchronize safely when online.

## Current state (2026-11-10)

- **Experimental desktop-owned Angular shell:** source now contains an Angular 20 application with a real astrological-charts renderer adapter, chart-first layout, collapsible navigation/inspector, light/dark themes, IT/EN labels, responsive sizing and PNG export paths. Synthetic assets are staged for Tauri 2 offline testing. **It has not been compiled or validated on Windows**; account login, sync, SQLite and real astronomy integration do not exist. See [Shell 001](docs/SHELL-001.md), [Spike 001](docs/SPIKE-001.md), [Native Runtime Bridge](docs/NATIVE_RUNTIME_BRIDGE.md) and [Windows Build Gate](docs/WINDOWS_BUILD_GATE.md).
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

## Renderer lifecycle safety

The Angular demo protects its rendering state against out-of-order async scene completions and window teardown. See [Render Lifecycle](docs/RENDER_LIFECYCLE.md); **real WebView2 behavior still requires Windows verification**.

## Quick read-only setup check

Run `node scripts/desktop-doctor.mjs` or `npm run doctor` on Windows to diagnose Node, Rust MSVC, WebView2, upstream Charts and Angular/Tauri build prerequisites. `npm run doctor:json` produces a shareable report with no personal paths. For the complete build attempt, use `scripts\\build-windows.cmd` (no PowerShell policy changes). See [Windows Build Gate](docs/WINDOWS_BUILD_GATE.md). This **does not prove the native app runs**; actual compilation and offline WebView2 testing remain pending.

## Current working prototype (stacked draft PR)

The first separate prototype branch adds `src-tauri/`, Node-based synthetic asset staging, offline bundle checks, eight existing Node tests and an unverified follow-up Angular shell. The subsequent asset-pipeline hardening adds an isolated synthetic-only staging process and verifies the Angular bundle without compiling the old charts demo. See [offline asset pipeline](docs/ASSET_PIPELINE.md). This is **not yet an installer or production application**. Clone both authorized private repositories side-by-side and follow [Spike 001](docs/SPIKE-001.md). Neither production VirgoStars nor original artwork is required.

## Planned documentation

The first design pull request introduces architecture, stack decision, offline authentication/sync, security, release/update strategy, roadmap, contributor guidelines and licensing decision log. These are **proposals**, not implemented features.

## Catalogo località offline

Il prototipo include un selettore locale nel pannello Parametri e un convertitore SQLite per gli export di città e stati. La selezione è temporanea e non modifica il grafico sintetico. Il catalogo privato si prepara separatamente con l’overlay Tauri descritto in [Catalogo offline](docs/LOCAL_CITY_PACKAGING.md); una build standard non lo include.

Per compilare su Windows con il catalogo completo condiviso nella release privata, dopo i prerequisiti di Charts e l’autenticazione GitHub CLI, eseguire `npm run tauri:build:places:windows`. Vedere [Catalogo offline](docs/LOCAL_CITY_PACKAGING.md).
