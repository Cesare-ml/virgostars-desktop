# VirgoStars Desktop

**An experimental, free and open-source desktop workspace for astrology.**

[License: CPAL-1.0](LICENSE) · [Contributing](docs/CONTRIBUTING.md) · [Roadmap](docs/ROADMAP.md) · [Security](docs/SECURITY_AND_PRIVACY.md)

VirgoStars Desktop is an offline-first workstation in development. It combines an Angular/TypeScript user interface, a Tauri 2/Rust host and an interactive Three.js astrological chart renderer. The goal is a professional desktop environment for exploring natal charts, transits, synastry and research workflows. Windows is the first tested platform; **macOS contributors are invited to help validate the new native build workflow**.

**Project status: prototype, not a production release.** The current application can show **synthetic demonstration positions** and exercises a limited native runtime bridge. An optional local-use provider can calculate real positions (see below), but the project does not yet offer independently validated astronomical calculations, production cloud synchronization, a finished personal-data archive, a signed updater, or a supported public installer. Screenshots and fictional chart data must not be treated as scientifically calculated birth charts.

## Build macOS on GitHub Actions · Compila Mac senza avere un Mac

**No Mac needed / Non serve possedere un Mac.** The repository has a [manually launched macOS DMG workflow](https://github.com/Cesare-ml/virgostars-desktop/actions/workflows/build-macos.yml) with GitHub-hosted Apple Silicon (`arm64`) and Intel (`x64`) runners.

1. Open **Actions → macOS DMG · manual → Run workflow** and choose the `main` branch.
2. Start the workflow and open its run page. When both jobs succeed, open **Artifacts** and download `virgostars-macos-arm64-test-…` and/or `virgostars-macos-x64-test-…`.
3. Each artifact contains the test `.dmg`, `SHA256SUMS.txt` and `build-report.json`. Inspect failures in the job logs; do not upload unknown files or secrets.

**Only `workflow_dispatch` triggers this job:** it does not run on push, create GitHub Releases, notarize software or require signing credentials. The DMGs are *unsigned/ad-hoc test builds using synthetic artwork*, not official installers; Mac launch and graphical behavior still require real-device acceptance testing. [Detailed build and release instructions](docs/MACOS_BUILD_AND_RELEASE.md).

## Help us build VirgoStars Desktop for Mac · Contribuisci alla versione macOS

**Have a Mac? You can help us create and test the first macOS build!**  
**Hai un Mac? Puoi aiutarci a compilare e provare VirgoStars Desktop su macOS.** Apple Silicon (M-series) and Intel x64 are both welcome.

**One-time setup:** install [Xcode Command Line Tools](https://developer.apple.com/xcode/resources/), [Node.js](https://nodejs.org/) 22.12+ or 24.x, [Rust](https://rustup.rs/) 1.90+ (including Cargo), and Python 3. Git and curl must also be available. If the Apple command-line tools are missing, run `xcode-select --install` and complete Apple's installer. **You do not need an Apple Developer account or access to private VirgoStars repositories for a test build.**

Then open **Terminal**, choose a clean work directory and run these **two commands**:

```bash
git clone https://github.com/Cesare-ml/virgostars-desktop.git && cd virgostars-desktop
npm run build:mac
```

The build script fetches pinned public Charts/Functions dependencies, checks the offline city database and DE441 1000–2200 base against fixed SHA-256 hashes, runs source checks and attempts a native macOS `.app` + `.dmg` build. A successful test build writes files into `.local/mac/output/<version>/<arm64-or-x64>/`:

- `VirgoStars-Desktop-<version>-macos-<arch>.dmg` — installer to test locally
- `SHA256SUMS.txt` — file integrity checksum
- `build-report.json` — version, source commit, target and build information

**How to contribute:** open a [GitHub issue](https://github.com/Cesare-ml/virgostars-desktop/issues) or [pull request](https://github.com/Cesare-ml/virgostars-desktop/pulls) with the macOS version, Mac model/CPU, the result of `npm run build:mac` (including any sanitized error output), whether the DMG installs and opens, and the build report/checksum. Never share passwords, signing certificates, private keys or personal chart data. Coordinate the DMG handoff with a maintainer before uploading it anywhere public.

**Status:** the workflow has been prepared but **has not yet passed a native macOS build or launch test**. The default test build uses *synthetic artwork*; original images have a separate redistribution-rights review. The public-data test bundle does not include every optional astronomical dataset. **Do not publish it as an official VirgoStars release.** A public release needs Mac acceptance testing, rights verification, Apple Developer ID signing/notarization and maintainer approval. There is a separate controlled upload procedure for an already-existing GitHub release.

For original-artwork builds, troubleshooting, signing and official release handoff, read the **[full macOS contribution and release guide](docs/MACOS_BUILD_AND_RELEASE.md)**.

## What works today

- Desktop-owned Angular UI with responsive navigation, light/dark modes and Italian/English labels. Language follows the WebView's system language by default (English fallback); language and theme overrides are in Settings. The welcome screen offers account access and remembers the choice to work locally. Local owner builds enable connected-account and persistent-session features; the backend has been enabled, while the Desktop build still needs end-to-end verification with a real account ([details](docs/OFFLINE_AUTH_AND_SYNC.md)).
- Integration adapter for the independently developed [Astrological Charts](https://github.com/Cesare-ml/astrological-charts) renderer, using locally generated synthetic assets.
- Prototype Tauri/Rust runtime and an experimental offline location picker.
- Synthetic-only build checks, unit tests, and read-only prerequisite diagnostics.
- **Prototype, off by default:** a chart-calculation command behind an `EphemerisProvider` port, with a new-chart form, a session chart list, transits, synastry between two calculated charts and five house systems. The modern UTC path covers 1900 to about 2033. Historical chart entry is deferred for the MVP and hidden in the form; previously saved historical records remain accessible. See [VirgoStars-Ephemeris provider](docs/VIRGOSTARS_EPHEMERIS_PROVIDER.md); without a local DE441 file the calculated chart is unavailable.
- **Prototype:** aspect and orb settings, per-point display settings and aspect tables for the active chart, transits and synastry. Applying/separating marks are limited to cases where motion is meaningful. See [Aspects and orbs](docs/ASPECTS_AND_ORBS.md).
- **Prototype:** solar and lunar returns of a calculated chart, with optional relocation and synastry with the radix. See [Returns](docs/RETURNS.md); like every calculation, they need the optional provider.
- **In preparation:** the private DE441 bundle defaults to a 1000–2200 base for future installers (not yet built or released), with contiguous optional-download design in [DE441 package plan](docs/DE441_DOWNLOAD_PLAN_2026-11-19.md). The current application does not yet offer pack downloads or selection in Settings.
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

For local development with the verified original artwork, place the authorized `astrological-assets` checkout beside this repository and run `npm start` (alias: `npm run start:private`). This serves only the approved, locally staged images. A public-only checkout can instead run `npm run start:synthetic` to use synthetic checkerboard fixtures; `npm run build:ui` and `npm run tauri:build` also remain synthetic by default. For a native prototype, start the Angular server first and then use `npm run tauri:dev`, or `npm run tauri:build` to attempt an executable build. `src-tauri/tauri.conf.json` currently has `bundle.active=false`: **these commands do not produce an end-user installer**. No VirgoStars account, production service, or restricted data package is required for the synthetic build.

### Cielo 3D — real planetary textures (optional offline add-on)

The experimental observer sky has an atmosphere toggle, collapsible controls, detailed planetary and star coordinates, and a **house-cusp grid linked to the chart's active house system**. The grid plots intersections on the ecliptic, not complete 3D house boundary planes.

To replace the illustrated planet portraits with licensed, NASA-data-derived surface maps, first run **once with an Internet connection**:

```bash
npm run sky3d:textures:download
```

Then start the private Angular frontend in one terminal:

```bash
npm start
```

Launch the native Desktop in a second terminal:

```bash
npm run tauri:dev
```

The Tauri configuration points to the existing `http://127.0.0.1:4200` frontend; it does not automatically start that server.

Maps from **Solar System Scope** are licensed **CC BY 4.0** and credited in the 3D sky. This is an explicitly requested download, **not** an automatic browser/network call. Private staging verifies the cached checksums and embeds the available maps into the offline bundle. Missing or undownloadable maps retain the existing illustrated portrait. Surface rotation, phases, illumination and apparent diameters are still illustrative, not time-accurate.

See [Cielo 3D: planet textures and house grids](docs/SKY_3D_REAL_PLANETS_HOUSE_GRID_2026-11-20.md) for source rights, geometric limits and outstanding validation. The current changes remain in a draft PR until Angular/Rust/Windows QA is complete.

The synthetic asset generator is designed to fail closed on unexpected, modified or unapproved assets. If the local generated pack already exists, follow [Asset Pipeline](docs/ASSET_PIPELINE.md) rather than overwriting it.

## Project architecture

The Rust host owns future native storage, security-sensitive system integration and astronomical engine adapters. Angular owns UI state, while Charts owns rendering. No private backend source is required to build the synthetic preview. The upstream public [VirgoStars Ephemeris](https://github.com/Cesare-ml/VirgoStars-Ephemeris) is independently developed and **not yet integrated as a validated runtime provider**.

For technical decisions and honest implementation status, read [Architecture](docs/ARCHITECTURE.md), [Offline Auth and Sync](docs/OFFLINE_AUTH_AND_SYNC.md), and [Roadmap](docs/ROADMAP.md).

## License, data and attribution

Original VirgoStars Desktop source code is provided under the **Common Public Attribution License 1.0 (CPAL-1.0)**. See [LICENSE](LICENSE), [NOTICE](NOTICE) and [Licensing and Publication](docs/LICENSING_AND_PUBLICATION.md). The license includes required attribution information, including **Powered by VirgoStars** and https://www.virgostars.it/. Keep this notice visible where the CPAL requires it, including GUI launch or session notices where applicable. The project is free and open source; using its code does not grant ownership of the VirgoStars name or logo.

Third-party packages, original artworks, fonts, commercial location databases, astronomy kernels, service credentials and user information are **not** relicensed by this repository. The standard development build uses synthetic assets; third-party materials must be reviewed and licensed independently before distribution.

## Contributing and responsible disclosure

Read [AGENTS.md](AGENTS.md) and [Contributing](docs/CONTRIBUTING.md). Use focused branches, tests and draft pull requests; report exactly what has been verified. Never include credentials, private information or production data in issues, fixtures or commits. For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

Only the maintainer-approved **manual** macOS DMG GitHub Action is enabled; there are **no automatic build or deployment triggers**. Official release publishing and distribution remain separate maintainer decisions.
