# Shell 001 — Angular chart-first desktop UI

**Status: Source implementation in a draft PR; Windows build NOT verified (2026-11-10).**

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
    npm run build:demo

Skip demo:pack only if the synthetic .local/demo-pack already exists. Never substitute private artwork.

In virgostars-desktop:

    npm install
    npm test
    npm run prepare:frontend
    npm run build:ui
    npm run tauri:build

The desktop package refers to the sibling compiled chart package using the npm file dependency (file:../astrological-charts/dist/grafici-astrologici). Run the upstream library build before npm install.

The existing synthetic staging command hashes and validates a generated local manifest, then produces .local/frontend/assets. The new Angular builder copies only its assets subdirectory to dist/desktop/browser/assets. The previous demo's JavaScript and HTML are *not* packaged in this new frontend, although its build is still needed by the first staging tool. A future PR should remove this historical dependency.

After setup, run npm run start in one console and npm run tauri:dev in a second; dev mode requires the Angular loopback server only. A completed Tauri build should embed Angular and synthetic assets, without an image server.

The existing PowerShell helper scripts/build-windows-spike.ps1 now builds the charts library and stages assets. Generated .local/frontend is intentionally not overwritten: remove only that ignored generated directory manually if rebuilding the synthetic stage.

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
- [ ] Replace old demo staging with an asset-only process and stabilize the nullable overlay API.

**No test is assumed to pass merely because it was written.** New source has not been built against Angular/Tauri here. Do not merge/release or change repo visibility without validation.

## Security and publication boundary

No production accounts, authentication secrets, real birth information, AWS deployment, private artwork, GitHub Actions, automatic updates, licensing decision or public release. The app remains a private experimental prototype.

## Accessibility and compact navigation (follow-up draft)

A stacked draft on the Angular shell adds compact navigation at widths ≤ 760px **without changing the central chart grid width**: the 60px icon rail expands over the workspace with a backdrop instead of resizing the chart. On first load under 1141px, the inspector starts collapsed, so it cannot obscure the chart until requested. Compact navigation and the inspector never open over each other.

Keyboard behavior: Escape closes a temporary navigation/inspector overlay and restores focus to its toggle. The inspector implements WAI-ARIA tab behavior with roving tab stop, Arrow Left/Right/Up/Down and Home/End, while labels remain IT/EN localized. The UI remains explicitly synthetic; no astronomical renderer duplication, account or sync work is introduced.

Source checks and Node pure-helper tests are tracked separately from the pending Windows Angular/Tauri/WebView2 build gate.
