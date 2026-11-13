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
