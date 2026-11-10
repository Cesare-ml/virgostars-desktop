# VirgoStars Desktop

**Private experimental repository — future free/open-source desktop application for astrologers and astrology researchers.**

VirgoStars Desktop will provide an offline-first professional workstation for Windows, with macOS support planned, powered by the independent VirgoStars astronomy, astrology and graphics libraries. Users sign in with their VirgoStars account on first activation, then can work offline with previously authorized local data and synchronize safely when online.

## Current state (2026-11-10)

- **Experimental Tauri renderer spike:** a minimal Tauri 2 Rust shell can be built using the real separate Astrological Charts Angular demo and an offline bundle of synthetic assets (see [Spike 001](docs/SPIKE-001.md)). **It has not yet been compiled or validated on Windows**, and there is no independent desktop UI, account login, synchronization engine, SQLite, or real astronomy integration.
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

## Current working prototype (stacked draft PR)

The first separate prototype branch adds `src-tauri/`, Node-based synthetic asset staging, offline bundle checks and five Node tests. This is **not yet an installer or production application**. Clone both authorized private repositories side-by-side and follow [Spike 001](docs/SPIKE-001.md). Neither production VirgoStars nor original artwork is required.

## Planned documentation

The first design pull request introduces architecture, stack decision, offline authentication/sync, security, release/update strategy, roadmap, contributor guidelines and licensing decision log. These are **proposals**, not implemented features.
