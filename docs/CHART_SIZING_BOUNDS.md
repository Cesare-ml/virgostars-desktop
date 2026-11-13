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
