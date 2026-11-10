# Windows build gate — read-only diagnostics and native acceptance

**Status (2026-11-10):** Node.js doctor code and fixture tests validated; Windows Angular/Tauri build **not yet verified**.

This guide is for contributors who want to run VirgoStars Desktop without needing to understand the full architecture. No real VirgoStars account, production data, artwork or AWS credential is required.

## 1. Prerequisites

Use Windows 11 x64 and install Node.js 22 LTS or 24, npm, Rust stable MSVC, Microsoft C++ Build Tools with the Desktop development with C++ workload, and WebView2. Clone authorized `astrological-charts` and `virgostars-desktop` repositories into sibling folders.

Official references: [Tauri Windows prerequisites](https://tauri.app/start/prerequisites/) and [Angular 20 compatibility](https://angular.dev/reference/versions).

## 2. Diagnose without installing or changing anything

From the desktop folder, run:

```powershell
node scripts/desktop-doctor.mjs
node scripts/desktop-doctor.mjs --stage=setup --json
```

The diagnostic checks Node/npm versions, Rust/Cargo and the Windows MSVC host, C++ tools, WebView2 registry presence, sibling package contract, Angular output path, lockfiles and generated build prerequisites. It reports `[OK]`, `[WARN]`, and `[BLOCK]`. A WebView2 registry warning is not proof of absence. It does not read user files or contact the network; the JSON report includes no local absolute paths or account details.

After dependencies are installed, use `node scripts/desktop-doctor.mjs --stage=build --strict`. After building, use `node scripts/desktop-doctor.mjs --stage=verify --strict`. Only `--strict` turns blocked findings into an exit error.

## 3. One-command Windows build attempt

From `virgostars-desktop`:

```powershell
powershell -NoProfile -File .\scripts\build-windows-spike.ps1
```

The runner uses `npm.cmd` on Windows to avoid the `npm.ps1` execution-policy issue. It first runs the read-only doctor, then uses the Charts repository's committed lockfile, builds only the upstream **library**, generates an original synthetic development asset pack if missing, installs desktop development dependencies, runs Node and Rust unit tests, builds the Angular UI with exact asset verification, compiles Tauri and checks expected output files. It stops at the first failed command.

It does not change PowerShell execution policy, delete generated folders automatically, access production, deploy software, or merge a PR. A successful build is not proof of scientific/visual accuracy.

## 4. Manual checkpoints (when investigating a failure)

In `astrological-charts`:

```powershell
npm.cmd ci
npm.cmd run build:library
npm.cmd run demo:pack
```

Only run `demo:pack` once, when `.local/demo-pack` is absent.

In `virgostars-desktop`:

```powershell
npm.cmd install
npm.cmd test
npm.cmd run doctor:build
npm.cmd run build:ui
npm.cmd run verify:bundle
npm.cmd run prepare:icon
cd src-tauri
cargo test
cd ..
npm.cmd run tauri:build
npm.cmd run doctor:verify
```

The first real install/build should create `package-lock.json` and `src-tauri/Cargo.lock`. Review and commit them separately; **never handwrite lockfiles**. The Tauri prototype still has `bundle.active=false`: no user installer or signed updater is produced.

To use `npm.cmd run tauri:dev`, launch `npm.cmd start` in another terminal first. The development server is not needed by the intended packaged offline executable.

## 5. Acceptance gate still pending

- [ ] Build Angular against the actual authorized Charts library and synthetic pack.
- [ ] Run Rust unit tests, compile a Windows x64 Tauri binary and verify the required prerequisites.
- [ ] Disconnect Internet and stop the dev server; launch the packaged test binary.
- [ ] Test the four chart modes, both themes, resize/fit, WebGL recovery and PNG export in WebView2.
- [ ] Verify browser-preview versus native-demo runtime state.
- [ ] Confirm no unexpected network requests, and test keyboard and contrast at 1280×720, 1366×768, 1600×900 and 1920×1080 with DPI scaling.
- [ ] Review generated npm/Cargo locks, dependencies, licenses and asset rights before any public build.

**Limitations:** The doctor checks local prerequisites and existence/consistency of output, not end-to-end rendering, native signing, astronomy accuracy or network isolation. The authoring environment lacks Rust and npm registry access; the Windows acceptance gate cannot be declared passed. The current executable name derives from the experimental Cargo package name `virgostars-desktop-spike`.

Do not report a release, perform GitHub Actions, merge on main, expose original artwork or change the repository license/visibility without a separate maintainer decision.
