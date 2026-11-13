# Integrated Windows x64 Desktop doctor checks

**Status: Draft / source-level implementation, not native Windows acceptance.**

This small integration reconciles the overlapping draft #71 with changes already
merged into main (#70 Node/Rust toolchain policy, #75 Windows PE header verifier,
#105 offline CSS build verification).

`scripts/desktop-doctor.mjs --stage=verify --strict` now:

1. Requires the generated Angular index and validates the active local stylesheet
   using the same `inspectDesktopStyles` helper as `npm run verify:css`.
2. On Windows, rejects non-x64 Node processes and continues to require the
   x86_64-pc-windows-msvc Rust host and the minimum supported Rust version.
3. Reuses `verifyWindowsExecutable` from `scripts/verify-windows-pe.mjs`
   for structural PE32+ AMD64 GUI verification instead of creating a second
   duplicate PE parser.
4. Contains exceptions from the verifiers without exposing local file paths
   in the diagnostic report. Setup and build-stage checks stay independent
   of unbuilt artifacts.

The new `tests/desktop-doctor-integrated-gates.test.mjs` covers seven
synthetic cases: positive Windows checks, ARM64 rejection, missing Angular
index, CSS errors, PE errors, non-Windows, and stages before verify.

## Required acceptance on a complete Windows checkout

```powershell
npm.cmd test
npm.cmd run verify:ipc
npm.cmd run build:ui
npm.cmd run verify:css
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
