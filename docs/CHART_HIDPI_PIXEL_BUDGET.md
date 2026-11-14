# High-DPI chart canvas budget

**Status:** Prototype / source-only regression verification; Windows WebView2 and
macOS WKWebView acceptance remain pending.

## Problem

Desktop previously capped a chart at 4,096 **CSS pixels** on each side.
At 200% display scaling, that CSS width can correspond to approximately
8,192 backing pixels per side even before optional renderer supersampling.
A very large editor window could therefore request a much larger GPU surface
than the original CSS-only limit suggests.

## Change

- `chartSide(width, height, padding = 24, devicePixelRatio = 1)` continues
  returning an integer CSS diameter that fits inside the padded stage.
- A fourth optional argument constrains `floor(4096 / max(1, DPR))`.
  One-times scaling and existing three-argument callers are unchanged.
- The Angular `fitStage()` call supplies `window.devicePixelRatio` each time
  the stage is measured. The upstream `GraficoRenderService` still owns
  the actual canvas and WebGL lifecycle.
- Non-finite, zero or negative ratios fail closed with diameter zero. The
  existing UI skips layout updates when the calculated diameter is under 32.
- Typical 800 × 600 desktop viewports still produce 552 CSS pixels, even
  at DPR 2; very large stages at DPR 1.25 / 2 / 3 instead cap to
  3276 / 2048 / 1365 CSS pixels respectively.

## Safety and limitations

This is an **estimated backing-pixel budget**, not an enforceable GPU memory
bound: the renderer may allocate additional surfaces or apply supersampling,
and system/display zoom can change independently of stage geometry. A DPI
change that does not trigger a ResizeObserver callback might require a
separate follow-up listener; do not claim that this patch handles every
multi-monitor transition. Verify Tauri/WebView behavior on real hardware.

No astronomical calculation, user data, personal records, account credentials,
native IPC/capability changes, network access, sync, asset licensing, build
dependencies, GitHub Actions or installer/release modifications occur.

## Reproduction and acceptance

In a clean authorized Desktop checkout, with public Charts sibling built:

```sh
node --experimental-strip-types --test tests/chart-sizing-bounds.test.mjs
npm test
npm run build:ui
```

The focused regression groups cover ordinary desktop sizes, huge finite
measurements, invalid scale values, fractional DPR, upper bounds, and static
wiring of the Angular stage to `window.devicePixelRatio`.

**Before merge:** manually inspect Windows WebView2 at 100%, 125%, 150%,
200% and multi-monitor scale changes; verify chart centering/zoom, resizing,
export PNG and absence of excess WebGL allocations. Check actual canvas
`width`/`height` and relevant GPU texture/resource use against the new
CSS values. Reconcile any changes to `desktop-app.component.ts` from
concurrent UI PRs. No real native acceptance has been run.
