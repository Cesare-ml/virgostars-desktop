# VirgoStars Desktop

**Private design-stage repository — future free/open-source desktop application for astrologers and astrology researchers.**

VirgoStars Desktop will provide an offline-first professional workstation for Windows, with macOS support planned, powered by the independent VirgoStars astronomy, astrology and graphics libraries. Users sign in with their VirgoStars account on first activation, then can work offline with previously authorized local data and synchronize safely when online.

## Current state (2026-11-10)

- **Design only:** this repository does not yet ship an installer, runnable desktop UI, authentication client, synchronization engine, or astronomical integrations.
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

## Approved functional end-state (not yet implemented)

The complete future feature scope is fixed in [docs/FEATURE_CATALOG.md](docs/FEATURE_CATALOG.md). It includes natal charts, transits, synodic/event navigation, returns, synastry, progressions, directions, traditional lots and methods, lunations, planetary hours, ephemerides and fixed stars; delivery is staged in the roadmap rather than promised for the first beta.

- [House systems](docs/HOUSE_SYSTEMS.md): **standalone Egyptian + all Swiss Ephemeris-compatible systems** from the independent Rust engine; **no Egyptian + Placidus hybrid**.
- [Fixed-star interpretations](docs/FIXED_STARS_INTEGRATION.md): position and selection inside Desktop; interpretation detail opens on the VirgoStars website through a verified canonical link, not a duplicated interpretation database.
- Explicit exclusions: **physiognomy, radionics, cosmocentric mode and chakras**, plus legacy commented-out menu concepts. Do not create a UI for excluded modules.
- All of the above are **planned requirements**, not implemented or validated features. The eventual app remains chart-centered with both light and dark visual modes.

## Planned documentation

The first design pull request introduces architecture, stack decision, offline authentication/sync, security, release/update strategy, roadmap, contributor guidelines and licensing decision log. These are **proposals**, not implemented features.
