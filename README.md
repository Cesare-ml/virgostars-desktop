# VirgoStars Desktop

**An experimental, free and open-source desktop workspace for astrology.**

[License: CPAL-1.0](LICENSE) · [Contributing](docs/CONTRIBUTING.md) · [Roadmap](docs/ROADMAP.md) · [Security](docs/SECURITY_AND_PRIVACY.md)

VirgoStars Desktop is an offline-first workstation in development. It combines an Angular/TypeScript user interface, a Tauri 2/Rust host and an interactive Three.js astrological chart renderer. The goal is a professional desktop environment for exploring natal charts, transits, synastry and research workflows on Windows, with macOS support planned.

**Project status: prototype, not a production release.** The current application can show **synthetic demonstration positions** and exercises a limited native runtime bridge. An optional local-use provider can calculate real positions (see below), but the project does not yet offer independently validated astronomical calculations, production cloud synchronization, a finished personal-data archive, a signed updater, or a supported public installer. Screenshots and fictional chart data must not be treated as scientifically calculated birth charts.

## What works today

- Desktop-owned Angular UI with responsive navigation, light/dark modes and Italian/English labels.
- Integration adapter for the independently developed [Astrological Charts](https://github.com/Cesare-ml/astrological-charts) renderer, using locally generated synthetic assets.
- Prototype Tauri/Rust runtime and an experimental offline location picker.
- Synthetic-only build checks, unit tests, and read-only prerequisite diagnostics.
- **Prototype, off by default:** a chart-calculation command behind an `EphemerisProvider` port, with a new-chart form, a session chart list, transits, synastry between two calculated charts and five house systems. It is calculated by the VirgoStars-Ephemeris engine (calendar years 1900 to about 2033) as soon as the user points the host to a local DE441 file, see [VirgoStars-Ephemeris provider](docs/VIRGOSTARS_EPHEMERIS_PROVIDER.md); without that file nothing is calculated and the labelled synthetic chart stays.
- **Prototype:** aspect and orb settings, per-point display settings and aspect tables for the active chart, transits and synastry. Applying/separating marks are limited to cases where motion is meaningful. See [Aspects and orbs](docs/ASPECTS_AND_ORBS.md).
- **Prototype:** solar and lunar returns of a calculated chart, with optional relocation and synastry with the radix. See [Returns](docs/RETURNS.md); like every calculation, they need the optional provider.
- **Prototype:** a chart-first workspace (full-height wheel, separate new-chart and archive panels, a planet table with longitude, house, speed and latitude); see [Workspace layout](docs/WORKSPACE_LAYOUT.md). A local chart archive, **encrypted at rest** with a key in the operating system's credential store ([details](docs/ENCRYPTED_ARCHIVE.md); not yet security-reviewed, no recovery key), keeps saved charts between runs. See [Chart archive](docs/CHART_ARCHIVE.md); it needs a separate security review before a beta.
- The function menu of the earlier Regolo Alpha Leonis program is listed in the Functions tab; entries not built yet are shown disabled.

Features under development include the canonical Rust astronomy engine, advanced astrological methods, secure encrypted local storage, account-aware synchronization, real chart computation and signed cross-platform distribution. The hosted VirgoStars service is separate from this open-source client.

## Build from source

This source build is aimed at contributors, **not** at end users seeking a finished installer.

Prerequisites: Git, Node.js 22.12+ or 24+, npm, Rust with the Windows MSVC toolchain for a native Windows build, Microsoft C++ Build Tools and WebView2. A modern browser can be used for frontend development. See [Windows Build Gate](docs/WINDOWS_BUILD_GATE.md) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

The current npm dependencies reference a **local build** of the public Charts library and a sibling checkout of [Astrological Functions](https://github.com/Cesare-ml/astrological-functions). Clone the repositories as sibling directories:

```powershell
git clone https://github.com/Cesare-ml/astrological-charts.git
git clone https://github.com/Cesare-ml/astrological-functions.git
git clone https://github.com/Cesare-ml/virgostars-desktop.git
cd astrological-charts
npm ci
npm run build:library
npm run demo:pack
cd ../virgostars-desktop
npm ci
npm run doctor
npm test
npm run build:ui
```

Run the local Angular development UI with `npm start`. For a native prototype use `npm run tauri:dev`, or `npm run tauri:build` to attempt an executable build. `src-tauri/tauri.conf.json` currently has `bundle.active=false`: **these commands do not produce an end-user installer**. No real VirgoStars account, production service or restricted data package is required for the synthetic build.

The synthetic asset generator is designed to fail closed on unexpected, modified or unapproved assets. If the local generated pack already exists, follow [Asset Pipeline](docs/ASSET_PIPELINE.md) rather than overwriting it.

## Project architecture

The Rust host owns future native storage, security-sensitive system integration and astronomical engine adapters. Angular owns UI state, while Charts owns rendering. No private backend source is required to build the synthetic preview. The upstream public [VirgoStars Ephemeris](https://github.com/Cesare-ml/VirgoStars-Ephemeris) is independently developed and **not yet integrated as a validated runtime provider**.

For technical decisions and honest implementation status, read [Architecture](docs/ARCHITECTURE.md), [Offline Auth and Sync](docs/OFFLINE_AUTH_AND_SYNC.md), and [Roadmap](docs/ROADMAP.md).

## License, data and attribution

Original VirgoStars Desktop source code is provided under the **Common Public Attribution License 1.0 (CPAL-1.0)**. See [LICENSE](LICENSE), [NOTICE](NOTICE) and [Licensing and Publication](docs/LICENSING_AND_PUBLICATION.md). The license includes required attribution information, including **Powered by VirgoStars** and https://www.virgostars.it/. Keep this notice visible where the CPAL requires it, including GUI launch or session notices where applicable. The project is free and open source; using its code does not grant ownership of the VirgoStars name or logo.

Third-party packages, original artworks, fonts, commercial location databases, astronomy kernels, service credentials and user information are **not** relicensed by this repository. The standard development build uses synthetic assets; third-party materials must be reviewed and licensed independently before distribution.

## Contributing and responsible disclosure

Read [AGENTS.md](AGENTS.md) and [Contributing](docs/CONTRIBUTING.md). Use focused branches, tests and draft pull requests; report exactly what has been verified. Never include credentials, private information or production data in issues, fixtures or commits. For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

This repository does not use GitHub Actions or perform automatic deployments. Publication of the source repository and distribution of release binaries are **separate maintainer decisions**.
