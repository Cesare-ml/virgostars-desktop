# Windows MVP integration candidate: Desktop UI + offline packaging

**Status: integrated source on a draft branch, not a validated Windows executable or public release.**

## Integration scope

This branch is based on **draft PR #109**, itself based on the chart/shortcuts/localization/fictional CSV/PNG stack from #103/#99/#93/#82. It additionally incorporates **draft PR #105**, the consolidated offline Angular HTML-root, base, active CSS, executable JS, synthetic/private asset manifest and browser-privacy gates.

The initial comparison found **zero overlapping modified paths** between these PR stacks, and the following merge was made **on a feature branch only**, with both parents recorded. All **23/23 files modified by #105** were imported as exact matching Git blobs; no CSS, privacy or script parser logic was rewritten.

### Important follow-up: newer main baseline

Git trees exposed additional original files from newer `main` that the older stacked UI branch did not yet carry, even though its `package.json` invokes one of them (`verify:native-ipc` through `verify:ipc`). Shipping the earlier naïve merged tree would have broken `npm run check`. Before opening this PR, the candidate was corrected by:

- Restoring **16 exact files** present in the current build-line tree and absent from the older UI line, including the native IPC scanner/tests, source license and NOTICE, civil-time/queue prototypes and device-only UI preferences.
- Adopting **13 additional exact updated files** from the current build-line tree where the UI stack had made no feature-specific edits (contributor guidance, publication/licensing docs, Rust runtime protocol and tests).
- Reconciling the changed Angular component **narrowly**: preserve the UI stack's keyboard shortcuts, IT/EN inspector display, localized errors and safe PNG/fictional CSV; incorporate `browserUiPreferencesStorage`, `loadUiPreferences` and `saveUiPreferences` so light/dark and IT/EN choices survive restart when non-sensitive WebView storage is available; set the HTML document language before the first chart draw.
- Preserving the **CPAL-1.0 'Powered by VirgoStars' footer attribution** from newer main alongside the CSV download status and existing controls. The local preferences module stores **only locale/theme/version**, never subjects, credentials or locations.
- Updating both Italian and English settings help for device-only UI preference persistence.

No real astronomy, cloud login or data sync was added. The existing local city selector does not alter fictional chart coordinates.

## Reproducible source checks

New `tests/windows-mvp-integration.test.mjs` covers the two build variants' package commands, CSS/JS/base/app-root and browser-privacy checks, Tauri output/CSP alignment, native IPC scanner presence, synthetic export boundaries, localized and locally persisted UI settings, shortcuts and CPAL attribution. These tests use only synthetic inputs and read source files; they do **not** launch WebView2.

```powershell
node --experimental-strip-types --test tests/windows-mvp-integration.test.mjs
npm.cmd test
npm.cmd run verify:ipc
npm.cmd run doctor:build
npm.cmd run build:ui
npm.cmd run verify:css
npm.cmd run verify:bundle
cd src-tauri
cargo test
cd ..
npm.cmd run tauri:build
npm.cmd run doctor:verify
```

Build prerequisites: authorized sibling `astrological-charts` with its built library and synthetic pack; Node 22.12+ or 24; on Windows 11 Rust stable MSVC 1.90+, C++ Build Tools, WebView2. Use the existing documented setup; do not touch production or release artifacts. Private-artwork builds additionally require explicit asset-rights approval and should not be substituted for the public synthetic pack.

## What was actually verified in this authoring environment

- **Tree-level integration:** 23/23 build-gate changed paths retained **byte-identical** to PR #105; the resulting tree includes every file that existed on the selected #105 head, plus the UI/CSV/PNG integration-only paths. Source/notice/IPC/preferences restoration is explicitly recorded above.
- **Node 22.16.0:** the unchanged upstream `tests/ui-preferences.test.mjs` and `src/app/ui-preferences.ts` matched their GitHub Git blob SHA-1 and passed **6/6 tests** in an isolated local mirror, including corrupted storage, blocked writes and no sensitive fields.
- **TypeScript 5.8.3 strict standalone:** `src/app/ui-preferences.ts` and the actual `workspace-state.ts` compiled successfully with a small **test-only `Locale` declaration** consistent with the GitHub `translations.ts` exported union. This is **not** an Angular component compilation.
- Earlier isolated PNG integration Node tests **19/19** passed and PNG modules compiled strictly; the unchanged new cross-feature test from PR #109 retains its exact Git blob hash.

**Not yet executed in this combined checkout:** the new `tests/windows-mvp-integration.test.mjs` under the actual Node test runner, the full `npm test`, `verify:ipc` CLI with complete local source, Angular `ng build` against the installed sibling Charts library, Cargo, Tauri, real Windows GUI/CSS/WebGL or native PNG/CSV save behavior. The authoring environment does not have a complete authorized local private-repo checkout. Static GitHub source checks and partial local mirrors do not satisfy these gates.

The source-side packaging verifiers can detect missing or inert CSS and unsafe files; only a **real Windows WebView2 run** can confirm the UI is fully styled and functional.

## Windows 11 offline acceptance

1. Run the source commands above and resolve all errors, including script and npm dependency mismatches, before attempting a native executable.
2. Launch the actual Tauri build with the Angular development server stopped and network disconnected; verify the top bar, navigation, inspector and large chart are styled under the current restrictive CSP.
3. Confirm Italian/English and light/dark changes, restart the app and verify only these settings persist. Do not store personal chart data in WebView storage.
4. Exercise four fictional chart modes, Alt+Shift shortcuts without stealing text-input focus, planet/house formatting, synthetic PNG and fictional CSV download on a normal and high-DPI display. An anchor click or footer status is **not** evidence that the OS saved a file.
5. Confirm offline city search behavior only if the licensed local catalog is separately available and authorized. Do not include the protected city ZIP in a public release.
6. Review CPAL attribution readability, third-party licenses, sensitive assets, signing, installer and source publication separately.

## Merge / publication controls

This is a stacked **Draft PR** targeting #109's feature branch, **not** `main`. PR #105 and #109 were not merged into `main`, no GitHub Actions were used, no deployment/release was triggered, and no repository visibility changed. The current repository includes a protected city catalog release: **do not publish it publicly** until the maintainer has completed `docs/PUBLICATION_CHECKLIST.md` and removed/relocated that restricted attachment.

Review the dependency chain and recompare the concurrently updated parent PRs before any final integration. The result is a **source integration candidate**, not a working public beta.

## Native IPC timeout and packaging preflight reconciliation (13 November 2026)

During integration review, main gained the completed **PR #113** fix for a Tauri runtime-probe ordering bug. The Windows MVP branch had retained the older `src/app/native/runtime-protocol.ts` and `tests/native-runtime.test.mjs` files, potentially reintroducing the error when integrated. Both are now **byte-identical to current main**, preserving the 4-second, fail-closed read-only IPC probe: the deadline is registered outside a Promise executor and before any native invocation is queued. A broken/synchronous timer cannot silently dispatch unbounded native IPC.

The mainline's corresponding `docs/NATIVE_RUNTIME_BRIDGE.md` section has also been preserved, without changing account/astronomy capability claims.

**Additional build guard:** `npm run tauri:build` and `npm run tauri:build:private` now invoke `npm run verify:ipc` *before* their existing Angular build and Tauri packaging stages. That avoids bypassing the IPC source/permission audit when a contributor runs the native build script directly instead of `npm run check`. This is a script-level gate; manually invoking the Tauri CLI can still bypass it. Optional city-catalog packaging is a separate workstream (#108), not implicitly authorized by this change.

### Evidence (integrated candidate, not a native acceptance test)

- **Actual Node.js 22.16.0 test runner** on byte-identical GitHub runtime source/test files (the updated source and test blobs are unchanged from merged PR #113): `node --experimental-strip-types --test tests/native-runtime.test.mjs` → **18/18 pass**, zero failures or skips.
- **TypeScript 5.8.3 strict standalone typecheck** of `src/app/native/runtime-protocol.ts` → **pass**.
- **All 10 current `tests/windows-mvp-integration.test.mjs` test bodies passed** in a JavaScript V8 isolated harness reading **19 exact branch file contents fetched from GitHub**; file reads were injected rather than executing Node's `readFileSync`. The eight original candidate checks plus two new contracts cover timeout registration before IPC and both normal/private native build script stage orders. **This is not a real `node --test` run or full Angular compile.**
- Verified Git blob SHAs:
  - Native helper: `ba933e01f69b678898c85427c1ba11aceadb296c`
  - Native 18-case test file: `a99509bbd409e411121ee5dae1c997487ee8c7fe`
  - Ten-case Windows integration file: `407477fffed23b615043131481a3089c4e0553f9`
  - Native-gated `package.json`: `8a04016bff0b460694887abdf7c5e7957cf85894`

**Still blocking beta claims:** actual complete-repository `npm test`, clean `npm ci`, public sibling Charts build, `npm run verify:ipc`, `npm run build:ui`, offline asset/private-output validation, Rust/Cargo, WebView2 Windows GUI CSS/keyboard/export/capability test, and full native packaging have **not** been executed on this integrated candidate. No main merge, production rollout, installer or repository visibility change has been performed.

## Windows PE x64 executable gate (2026-11-13)

The candidate now includes the **read-only PE32+ header verifier** already developed and reviewed in the separate Windows build line (#75, later carried by #105):

- Exact imported `scripts/verify-windows-pe.mjs` checks a fixed native build path for a regular, non-symlinked AMD64 PE32+ Windows GUI executable; bounded DOS/PE offset, required executable section, image/section lengths, real byte ranges and best-effort unchanged file metadata. It reads **at most 8 KiB** without changing the file.
- Exact imported `scripts/build-windows.cmd` and `scripts/build-windows-spike.ps1` run the PE verifier after native build and `doctor:verify`. Both launchers preserve explicit error handling; the PowerShell path packages the previously audited Angular output without rebuilding it through the ordinary `tauri:build` npm script.
- Exact imported `tests/windows-pe-header.test.mjs` and `docs/WINDOWS_PE_HEADER_GATE.md` record negative cases and actual Windows manual acceptance. All five imported blobs remain byte-identical to #105 at the time of integration.

### Executed verification of the imported files

**Node.js 22.16.0** using the actual GitHub-matching source and test files in an isolated local mirror:

```sh
node --test tests/windows-pe-header.test.mjs
node --check scripts/verify-windows-pe.mjs
node --check tests/windows-pe-header.test.mjs
```

Result: **8/8 Node tests PASS; 0 failures or skips**. The tests cover valid synthetic AMD64 PE GUI, forged/truncated signatures, invalid sections and entrypoint, disk-read and symlink rejection, path-safe CLI usage, and exact launcher invocation after packaging. The four tested files exactly match the GitHub blob SHA-1 values:

- PE validator: `361b3b370515b548fb791f2e1daedcb4c864acda`
- PE tests: `6487857e2e20881e9f777a4ae6a5d699413c15f4`
- Batch launcher: `28f8b60a2baeb403192de8df330f9d756e95d0cd`
- PowerShell launcher: `8b6bf1acf39329322a59f0258ae2689044d3ab31`

The verifier recognizes **structural consistency only**; it cannot prove that the app runs, that the binary is signed, that the image is safe or that WebView2 loads CSS and saves exported PNG/CSV files. A genuine Windows x64 executable was **not** built or launched in this test environment. Full combined `npm test`, Rust/Cargo, Angular/Charts and native Windows offline smoke remain release blockers.
