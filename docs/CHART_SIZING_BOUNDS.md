# Chart canvas sizing bounds

Status: **Prototype / isolated Node + TypeScript verification**, not a native WebView2 acceptance result.

## Why

The chart-first shell derives a square CSS canvas width/height from the observed
stage dimensions. The previous pure helper correctly rejected non-finite,
negative or heavily padded sizes, but accepted arbitrarily large *finite*
measurements. If a custom host, monitor configuration, faulty measurement or
unexpected resize propagated such dimensions, the UI could request an enormous
canvas and stress memory/GPU resources.

## Behavior

- `chartSide(width, height, padding = 24)` keeps its prior results for
  ordinary viewport sizes and floor-to-integer behavior.
- The computed **CSS diameter** is now capped at **4096 CSS pixels** via
  `MAX_CHART_SIDE_CSS_PX` in `src/app/workspace-state.ts`.
- Invalid, negative, non-finite, or entirely padded measurements still yield
  zero; the existing component ignores diameters below 32.
- No native IPC, render calls, layout templates, graphics dependency or
  stored account/birth information change. The upstream
  `astrological-charts` renderer continues to own its WebGL resource lifecycle.

**Important:** 4096 CSS pixels is a conservative UI guard, **not** a guarantee
of low GPU allocation, universal WebGL texture support or stability. Actual
backing-buffer dimensions depend on device pixel ratio and the renderer's
internal settings. Do not treat this as a fix for the Windows CSS-loading or
small-chart regression until a real native GUI run confirms it.

## Verification

In the authorized desktop checkout:

```sh
node --experimental-strip-types --test tests/chart-sizing-bounds.test.mjs
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler src/app/workspace-state.ts
npm test
npm run build:ui
```

The first two commands were **actually run** in an isolated checkout with
Node.js 22.16.0 and TypeScript 5.8.3: 4/4 tests passed; strict TypeScript
compilation passed. The Git object bytes for the helper and the test have
been compared with the committed GitHub blobs.

**Not run:** the repository-wide test suite, Angular build against the sibling
Charts package, Tauri/Cargo, Windows 11 WebView2 or macOS WKWebView.

## Native acceptance still required

1. Verify 1920×1080, 2560×1440, 4K and multi-monitor/high-DPI resize behavior.
2. Check responsive navigation and inspector toggles and fit/zoom/PNG export.
3. Check WebGL backing sizes and memory at 125%, 150%, and 200% scaling.
4. Ensure any CSS-loading issue is investigated separately, without weakening CSP.

This PR changes no release, production system, private assets, license, data
persistence, network endpoint or GitHub Actions setting.

## Integrated chart-fit / shortcut regression — 13 Nov 2026

The exact reviewed sizing helper and four original unit tests from draft **#84** are now included in stacked desktop-shell draft **#103**, built on #99. This is an integration of the same fix, **not** a separate replacement; avoid merging both copies independently.

New `tests/chart-fit-shortcuts-integration.test.mjs` adds four executable cross-module regressions covering: guarded fit intent with extreme measured sizes; repeated panel layout changes; editable-focus/invalid-measurement refusal; and preservation of the same **22 fictional CSV coordinates** while shortcut intents are parsed.

**Actual validation:** Node.js **22.16.0** ran the four original sizing cases plus the four new integration cases — **8/8 passed**. The complete *selected pure-module* isolated mirror also ran **72/72 Node tests passed**, zero failures, using `node --experimental-strip-types --test --test-skip-pattern='actual desktop source|desktop error state|the Angular component|the template announces|integrated Angular shell|integrated template|merged component|merged Angular|Angular uses validated' tests/*.test.mjs`. The pattern omits source-level tests requiring the complete Angular checkout. TypeScript **5.8.3** compiled **eight pure TypeScript modules** with `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM`. The tested sizing helper, original test and new integration test have exact Git object SHA identity with the GitHub branch:
- `src/app/workspace-state.ts`: `d56b55933305ed7d01b3dd6ee719ad9fd77a2c05`
- `tests/chart-sizing-bounds.test.mjs`: `c0dc3851daf2eac1145072f5b4a72eb40c50cad7`
- `tests/chart-fit-shortcuts-integration.test.mjs`: `1ab6e5df3c2c59f04fdb923d77fbef4be1cc4a07`

The actual Angular `fitStage()` calls `chartSide(bounds.width,bounds.height,24)` before changing the canvas CSS size; this and related shortcut/CSV/PNG wiring were checked by **11/11 direct GitHub source assertions**. Those are static checks, **not** a compiled Angular test.

The cap applies to **CSS size only**. The real GPU backing buffer, device-pixel ratio, WebGL renderer memory, physical monitor resizing and Windows WebView2 behavior still require native acceptance. The isolated suite does **not** establish `npm test` or `npm run build:ui` on a complete dependency checkout. No production, CI, release or main merge has been performed.
