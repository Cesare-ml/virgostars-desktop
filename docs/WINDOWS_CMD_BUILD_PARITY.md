# Windows CMD and PowerShell build-gate parity

**Status:** Source-level correction for the experimental Windows 11 x64 desktop build. **No native executable or installer is claimed.**

## Problem

The two supported manual launchers previously followed different paths:

- `scripts/build-windows-spike.ps1` ran `verify:ipc`, `verify:css`, and then used `npm.cmd exec --offline -- tauri build` to package the *already checked* Angular bundle.
- `scripts/build-windows.cmd` ran neither `verify:ipc` nor `verify:css`, and used `npm.cmd run tauri:build`. The latter command executes `build:ui` again, after the previous Angular output had been checked. The second build could silently invalidate prior CSS or bundled-asset evidence.

This difference matters because a successful packaged Tauri build is not evidence that the inspected JavaScript and stylesheet are the exact files ultimately shipped.

## Correction

The CMD launcher now has the following **fail-closed** sequence after dependency setup:

```text
npm.cmd test
npm.cmd run verify:ipc
npm.cmd run doctor:build
npm.cmd run build:ui
npm.cmd run verify:css
npm.cmd run prepare:icon
cargo test
npm.cmd exec --offline -- tauri build
npm.cmd run doctor:verify
node scripts\verify-windows-pe.mjs
```

Every command above has an immediate `if errorlevel 1 goto :failed` check. `npm.cmd exec --offline -- tauri build` does not invoke the `tauri:build` npm script's second Angular build. It invokes the existing local Tauri CLI. It is **not** a guarantee that the actual Windows binary boots or that WebView2 loads the stylesheet; those checks remain manual.

The PowerShell launcher is unchanged because it already followed this order. The general-purpose `npm run tauri:build` script is intentionally unchanged, but **must not** be substituted at this point in the audited build sequence.

## Regression tests

`tests/windows-cmd-build-parity.test.mjs` adds eight Node tests protecting the two launchers and their actual `package.json` script references:

1. Exactly one correctly ordered and error-checked CMD gate for each stage.
2. Reuse of the audited frontend rather than `tauri:build`.
3. Equivalent ordering for the PowerShell path.
4. Detection when the CMD native IPC audit is removed.
5. Detection when CSS validation is removed or moved after packaging.
6. Detection when the second Angular build returns or error handling is disabled.
7. PE32+ x64 structural validation after native build and doctor checks.
8. No newly introduced disabling of browser security or publishing/deployment commands.

### Validation actually performed (2026-11-13)

- Fetched actual GitHub files from the new feature branch and verified their Git blob identities, including the patched CMD script `a1dd0dbc88144d999557a4ac6308c0aaa6baa76e`, unchanged PowerShell script `8b6bf1acf39329322a59f0258ae2689044d3ab31`, package scripts `8a04016bff0b460694887abdf7c5e7957cf85894`, and new test file `8efa50ef46470d9b7b28509463de619bcecd75d9`.
- Executed **8/8 direct source-level checks** using the fetched GitHub source (ten ordered CMD gates, fail-closed exits, PowerShell stage ordering, no repeated Angular build, npm script wiring, and four mutations correctly rejected).
- The eight new Node test cases are **authored and committed**, but **were not executed through the Node test runner against a full local checkout** in this session. Their presence does not count as an `npm test` pass.

Run these commands in a complete authorized checkout to validate the committed tests and perform a native build:

```powershell
node --experimental-strip-types --test tests/windows-cmd-build-parity.test.mjs
npm.cmd test
npm.cmd run verify:ipc
powershell -NoProfile -File .\scripts\build-windows-spike.ps1
```

Or, from Command Prompt:

```bat
scripts\build-windows.cmd
```

The launchers install/build local dependencies and compile the prototype; **do not execute them as a read-only diagnostic**. Use `npm.cmd run doctor` to inspect prerequisites without building.

## Boundaries

The current chart still contains deliberately fictional demo coordinates. This change does not alter Rust astronomy, native IPC permissions, personal data, protected city assets, accounts, CPAL attribution, remote APIs, dependencies, GitHub Actions, repository visibility or production deployments. The complete Angular/Charts build, Cargo/Tauri, offline WebView2 CSS/PNG/CSV, signing and human acceptance remain pending.

This patch is stacked on **draft PR #112** and must be reconciled with concurrently updated Windows packaging work before any merge.
