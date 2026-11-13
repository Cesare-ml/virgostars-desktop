# Integrated Windows x64 Desktop doctor checks

**Status: Draft / source-level implementation, not native Windows acceptance.**

This small integration reconciles the overlapping draft #71 with changes already
merged into main (#70 Node/Rust toolchain policy, #75 Windows PE header verifier,
#105 offline CSS build verification).

`scripts/desktop-doctor.mjs --stage=verify --strict` now:

1. Requires the generated Angular index and validates the active local stylesheet
   using the same `inspectDesktopStyles` helper as `npm run verify:css`.
   The verify stage also reuses the dependency-free `inspectDesktopScripts`
   inspector to require bounded, local Angular main/polyfills ESM entrypoints.
   A CSS-only page lacking an executable main module can no longer pass the
   doctor. Zero-byte main and polyfills files also fail the shared script gate.
   The deeper chunk graph and assets are still checked by `verify:bundle`.
2. On Windows, rejects non-x64 Node processes and continues to require the
   x86_64-pc-windows-msvc Rust host and the minimum supported Rust version.
3. Reuses `verifyWindowsExecutable` from `scripts/verify-windows-pe.mjs`
   for structural PE32+ AMD64 GUI verification instead of creating a second
   duplicate PE parser.
4. Contains exceptions from the verifiers without exposing local file paths
   in the diagnostic report. Setup and build-stage checks stay independent
   of unbuilt artifacts.

The `tests/desktop-doctor-integrated-gates.test.mjs` covers positive Windows
checks, ARM64 rejection, missing Angular index, independent CSS/JS failures,
exception redaction, PE errors, non-Windows, and stages before verify.
The `desktop-doctor-real-artifacts.test.mjs` suite additionally verifies the
actual filesystem with synthetic CSS and JS artifacts, without mocking the
inspectors; it is not a Windows/WebView2 execution test.

## Required acceptance on a complete Windows checkout

```powershell
npm.cmd test
npm.cmd run verify:ipc
npm.cmd run build:ui
npm.cmd run verify:css
npm.cmd run verify:bundle
npm.cmd run doctor:verify
cd src-tauri
cargo test
cd ..
npm.cmd run tauri:build
npm.cmd run doctor:verify
node scripts/verify-windows-pe.mjs
```

Then launch the built prototype offline in Windows 11 x64 and inspect
WebView2 CSS, native capabilities, chart rendering and window lifecycle.
These checks do **not** establish executable signing, native startup,
astronomical accuracy, provenance of external data or release readiness.

No GitHub Actions, production changes, private data, artwork, deployment,
release, visibility or automatic merge is included.
