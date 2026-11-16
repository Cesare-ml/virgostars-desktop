# Desktop MVP acceptance gate — 2026-11-16

Status: **Prototype**. This document is an acceptance checklist, not a claim that an installer or validated astronomy engine exists.

## Target experience

On Windows, launch the local Tauri executable without an Angular development server or network access. The main window must render the approved Angular UI and Charts visualization, show a clear synthetic/demo label when calculated data are unavailable, and remain usable without authentication. A calculated chart must never silently fall back to fictional positions.

## Automated preflight

From the Desktop checkout with dependencies installed:

```powershell
node --test tests/desktop-mvp-startup-contract.test.mjs
npm run verify:version
npm run verify:ipc
npm test
npm run build:ui
npm run verify:css
npm run verify:bundle
```

On a Windows machine with Rust MSVC and WebView2 installed:

```powershell
npm run doctor:build
cd src-tauri
cargo test --locked
cd ..
npm run tauri:build
```

The Tauri configuration currently sets `bundle.active=false`. A successful native build does **not** create an end-user installer.

## Manual offline acceptance

1. Stop `ng serve` and disconnect the machine from the network.
2. Launch the freshly built native executable directly; record whether the window appears and whether the stylesheet loads.
3. Verify demo positions are visibly identified as synthetic and cannot be mistaken for calculated natal data.
4. Verify the application can navigate between tabs and change theme without a network request.
5. Verify resize at 1280×720 and 1920×1080, WebGL canvas recovery, and chart PNG export.
6. If the optional Swiss provider was built for local use, independently compare real calculation outputs with a trusted reference. Without that provider, mark real calculations **not available**, not passed.
7. Restart the application offline and verify the previously saved non-sensitive local chart state is handled correctly; do not assume the current unencrypted archive meets production privacy requirements.

Record the executable path, build commit, test counts, operating system, and each failure in the PR. Do not record user home paths, personal charts, tokens, or credentials.

## Release blockers

- Real astronomical output is not independently validated and the canonical VirgoStars Ephemeris runtime is not integrated.
- SQLite chart archive is currently unencrypted; production personal-data storage needs a security review.
- Native Windows offline GUI acceptance and installer signing remain unverified.
- Third-party Swiss Ephemeris and place catalog redistribution rights require separate review.

This slice adds source-level regression tests for the offline startup contract. It does **not** enable packaging, change CSP, modify native permissions, deploy, or merge to main.
