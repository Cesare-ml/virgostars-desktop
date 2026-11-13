# Synthetic PNG export in the integrated desktop workspace

**Status: Prototype / stacked draft integration**, not an accepted Windows build or a real astronomical calculation.

## Change and provenance

This branch starts from **draft PR #103** (`integrate/chart-keys-synthetic-workspace-20261113`), which stacks the existing synthetic chart/inspector/CSV, IT/EN localization and local keyboard shortcuts. It incorporates the existing synthetic-only PNG validation and browser-anchor cleanup from **draft PR #53**, rather than introducing an alternative PNG exporter.

The following files were copied **byte for byte** from PR #53:

- `src/app/png-export-safety.ts` — allow only bounded PNG-shaped base64 data URLs and fixed synthetic filenames.
- `src/app/png-download.ts` — dependency-injected temporary anchor; append before click, always attempt removal in `finally`.
- `tests/png-export-safety.test.mjs` and `tests/png-download.test.mjs` — existing 16 executable regression cases.
- `docs/PNG_EXPORT_SAFETY.md` — behavior, format limitations and Windows acceptance.

The *only* product-code adaptation was in `src/app/desktop-app.component.ts`: capture chart mode/theme **before** awaiting the renderer, validate the returned PNG data URL and fixed filename, and pass the already-validated values to `requestSyntheticPngDownload`. This preserves the existing chart-mode keyboard guards, bilingual inspector/error behavior, and synthetic CSV browser adapter from #103/#99/#93.

`tests/synthetic-png-workspace-integration.test.mjs` adds six cross-feature test cases (three real pure behavior tests, three complete-repo source-contract tests). It is automatically included by the existing `npm test` glob once this branch is checked out in full.

## Exact validation achieved (Node.js 22.16.0, TypeScript 5.8.3)

```sh
node --experimental-strip-types --test \
  --test-skip-pattern='Angular PNG path|merged desktop|merged template' \
  tests/png-export-safety.test.mjs \
  tests/png-download.test.mjs \
  tests/synthetic-png-workspace-integration.test.mjs

tsc --noEmit --strict --target ES2022 --module ESNext \
  --moduleResolution bundler --lib ES2022,DOM \
  src/app/workspace-state.ts src/app/png-export-safety.ts src/app/png-download.ts
```

- **19/19 Node tests PASS** in an isolated local mirror (16 original and 3 cross-feature behavioral cases). These are the *actual committed test files* with verified Git blob identity.
- **TypeScript strict PASS** for the original PNG modules and actual `workspace-state.ts` contract; the latter matches the committed Git blob.
- **14/14 direct static source assertions PASS** against the exact GitHub Angular component, template and translation files. These confirm import/wiring order, preserved CSV and keyboard functionality, safe DOM adapter, and localized inspector.
- Three newly authored source-contract tests were **not run via Node in that partial mirror**, which lacks a full Angular tree; they must be executed under `npm test` in a complete checkout. Static assertions are not equivalent to executing those tests or compiling Angular.

Verified immutable Git blob IDs:

- `png-export-safety.ts`: `147ec126d6727999c8fb6c5f9fd4d31a8da5123e`
- `png-download.ts`: `dfeb2a0aada886ac60bd2a128725aefff3ad87eb`
- `png-export-safety.test.mjs`: `dee8f78272450082a139a5f8b72ea2c2c8e95400`
- `png-download.test.mjs`: `745f2e7482c7050dc2827b01a9eff8f2c359ffa4`
- New cross-feature tests: `2bf2b298e4aeff77d9d0af1f1bae92d82987afd2`
- `workspace-state.ts`: `53f79fae35a2332a1b32fc3732665f5279980f3e`

## Required before integration or release

1. Recompare parent PR #103 (and its ancestor #99/#93 branches) with this branch: concurrent agents may add more changes. Resolve overlaps instead of independently merging #53 and this PR's copied files.
2. In a complete authorized Windows 11 x64 checkout, run `npm.cmd test`, build the separately authorized `astrological-charts` sibling library and synthetic asset package, then `npm.cmd run build:ui`, `npm.cmd run verify:css`, `npm.cmd run tauri:build` and `npm.cmd run doctor:verify`.
3. With the development server stopped and the Internet disconnected, verify the *actual* Tauri/WebView2 desktop layout, four fictional chart modes, IT/EN labels, shortcut exclusion while typing, CSS, DPI/resize, a real PNG download into the local filesystem in light/dark modes, and the already-existing fictional CSV flow.
4. A successful `anchor.click()` **does not prove** that WebView2 saved the file. The PNG validator checks signature, IHDR and bounds, **not** all PNG chunk CRCs or rendered pixel accuracy. It does not confer scientific validity.

No private records, astronomy algorithms, authentication, network calls, native IPC permissions, release artifacts, GitHub Actions, main merges, production, license or repository visibility changes are authorized or made by this integration. Keep it **Draft**.
