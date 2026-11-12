# Shell 001 — Angular chart-first desktop UI

**Status (2026-11-10): A maintainer has compiled and launched a Windows Tauri .exe with synthetic chart rendering and native IPC. However, global/Angular component styles do not appear to be applied in the observed UI, so the chart-first visual acceptance gate remains FAILED/pending. See [Windows GUI Smoke](WINDOWS_GUI_SMOKE_2026-11-10.md).**

## Scope

- PR #1 is the architectural foundation; PR #3 creates the Rust/Tauri synthetic spike; this PR adds a desktop-owned Angular application.
- The palette, wide central chart, compact navigation and right inspector follow the separate UI guidelines in PR #2. This PR does not copy the design image.
- The actual renderer comes from the separately built private grafici-astrologici Angular library. Its code and artwork are not copied.
- All chart data in src/app/fictional-fixture.ts are deliberately **fictional**, not astronomical measurements and not suitable for interpretation.

## What exists in source

A 60px top bar, collapsible left navigation, four renderer modes, a chart-first central workspace, and a collapsible inspector with simulated planetary longitudes and houses. Light and dark appearance use semantic CSS tokens; the chart is switched between the actual library skins light and dark. Italian and English interface labels are included.

The chart container uses both available width and height to compute a square canvas with safe padding. ResizeObserver propagates panel-induced size changes to the existing renderer window resize listener. Zoom in/out, Fit chart and PNG export call the existing GraficoRenderService. Inspector selection does **not** yet highlight the corresponding body in the chart.

No login, cloud connection, synchronization, secure local storage, actual ephemeris data or updater is present. The interface explicitly indicates that it is a local synthetic lab.

## Build procedure — Windows 11 x64 development

Clone the two authorized private repositories as sibling folders named astrological-charts and virgostars-desktop. Install Node.js 22 LTS, npm, Rust MSVC, Microsoft C++ Build Tools and WebView2. Registry access is needed during dependency installation.

In astrological-charts:
    
    npm ci
    npm run build:library
    npm run demo:pack
    # No upstream demo build needed

Skip demo:pack only if the synthetic .local/demo-pack already exists. Never substitute private artwork.

In virgostars-desktop:

    npm install
    npm test
    npm run build:ui        # stages images, builds Angular, verifies offline bundle
    npm run tauri:build     # repeats safe verification before building Tauri

The desktop package refers to the sibling compiled chart package using the npm file dependency (file:../astrological-charts/dist/grafici-astrologici). Run the upstream library build before npm install.

The synthetic-only staging command now reads the generated manifest and images **without building the old demo**. It places only approved synthetic assets under .local/frontend/assets. The desktop Angular builder emits dist/desktop/browser/assets, then the new verifier checks exact SHA-256 matches, no extra images and the actual desktop entrypoint. See [asset pipeline](ASSET_PIPELINE.md).

After setup, run npm run start in one console and npm run tauri:dev in a second; dev mode requires the Angular loopback server only. A completed Tauri build should embed Angular and synthetic assets, without an image server.

The existing PowerShell helper scripts/build-windows-spike.ps1 now builds the charts library and stages assets. A previously generated .local/frontend is reused only when all expected synthetic files and hashes match. If it contains stale demo files, unauthorized files or changed content, the script fails closed; inspect and manually delete **only** that ignored generated directory before staging again.

Current package-lock.json and Cargo.lock have **not** been generated in this environment; they must be created/reviewed in the next Windows build verification. The desktop Rust build still has bundle.active=false, so it does not emit an MSI/NSIS installer.

## Tests and acceptance

New test files cover: chart sizing using both dimensions, invalid sizes, supported modes, full IT/EN translation keys, library import contract, Tauri Angular dist/asset settings, clearly disabled future features, and light/dark shell tokens. Eight earlier synthetic packaging/icon tests also exist.

- [ ] Install exact dependencies and generate a reviewed npm lockfile.
- [ ] Build Angular with the real compiled renderer and resolve any peer incompatibility.
- [ ] Compile Rust/Tauri on Windows; generate a reviewed Cargo lockfile.
- [ ] Disconnect Internet and all dev servers; verify all four chart modes, both themes, zoom/fit and PNG export.
- [ ] Check WebView2 CSP and no external requests.
- [ ] Visually inspect 1920x1080, 1600x900, 1440x900, 1366x768, 1280x720 with 125/150% OS scaling, including keyboard and contrast.
- [ ] Measure WebGL resource lifecycle; test context-loss recovery.
- [x] Replace old demo staging with asset-only preparation and post-build verifier (Node fixture tests pass; real Windows build still unverified).
- [ ] Stabilize the nullable overlay API and validate packaged WebView2 rendering.

**No test is assumed to pass merely because it was written.** New source has not been built against Angular/Tauri here. Do not merge/release or change repo visibility without validation.

## Guest appearance and language preferences

The Angular shell restores light/dark and Italian/English from a strict, device-only
versioned UI preference record. Storage errors do not block guest startup or toggles,
and no chart, city, account, token or subject data are persisted there. This prototype
needs a full Windows WebView2 close/reopen validation before visual acceptance.
See [device-only UI preferences](UI_PREFERENCES.md).

## Local Adesso clock

The chart header now shows a 1-second, device-local date and time readout with
IT/EN formatting, local timezone label and compact layout. It re-samples wall
time after device sleep, disposes the timer on component teardown and never
triggers a synthetic chart redraw. **This is not live ephemeris output**: the
actual chart remains a fictional fixture until the canonical Rust engine and
validated native IPC integration are available. See [Now clock](DEVICE_CLOCK_NOW.md).

## Security and publication boundary

No production accounts, authentication secrets, real birth information, AWS deployment, private artwork, GitHub Actions, automatic updates, licensing decision or public release. The app remains a private experimental prototype.
