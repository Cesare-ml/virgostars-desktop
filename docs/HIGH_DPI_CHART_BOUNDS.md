# High-DPI chart sizing bound

**Status:** locally tested pure layout guard; the actual Tauri/WebView2 canvas backing store is **not verified**.

## Problem and scope

The chart stage previously capped the CSS side to 4096 pixels without taking the display's device-pixel ratio (DPR) into account. At DPR 2 or 3, a renderer that multiplies CSS pixels by the display scale could request much larger physical drawing surfaces and consume excessive graphics memory.

`chartSide(width, height, padding, devicePixelRatio = 1)` now preserves the old three-argument layout behavior but also caps the CSS diameter at `floor(4096 / max(1, DPR))`. This always rounds down. A DPR less than one never permits a larger CSS surface, while a non-finite or non-positive value returns zero rather than an unbounded size.

The Angular `fitStage()` caller now passes `window.devicePixelRatio`. No new dependencies, IPC commands, renderer APIs, network services or native permissions were added. Standard viewport sizes continue to fit by both stage dimensions and padding.

| DPR | Maximum chart CSS side |
| --- | ---: |
| 1× | 4096 px |
| 1.25× | 3276 px |
| 1.5× | 2730 px |
| 2× | 2048 px |
| 3× | 1365 px |
| 4× | 1024 px |

## Boundaries and caveats

- **Not a guarantee of allocated GPU pixels:** the upstream `astrological-charts` renderer owns the actual WebGL buffer, device-pixel ratio policy, zoom behavior and texture lifecycle. The host's drawing-buffer dimensions must be inspected on real hardware.
- This only updates when `fitStage()` executes. Display-scale changes that do not trigger an observed stage resize may require an additional event lifecycle; multi-monitor moves and zoom must be checked separately.
- An invalid DPR currently leaves `fitStage()` without a new size because diameters below 32 are ignored; no scientific snapshot or rendered chart is promoted by this guard.
- The previously observed Windows WebView2 CSS-not-loading problem remains a distinct acceptance blocker. Do not disable the Tauri CSP or introduce online stylesheets.
- The new `devicePixelRatio` argument is optional; older callers and tests keep the same results. No birth records, astronomical methods, profile keys, offline data, syncing, packages or assets are involved.

## Verification performed

In an isolated local Node.js 22.16.0 environment, with the source and new test matching the committed Git blob SHA:

```sh
node --experimental-strip-types --test tests/chart-sizing-bounds.test.mjs tests/chart-high-dpi-bounds.test.mjs
tsc --noEmit --strict --target ES2022 --module ES2022 --moduleResolution bundler --lib ES2022,DOM src/app/workspace-state.ts
```

Result: **9/9 Node tests passed** (four existing + five new groups); standalone TypeScript 5.8.3 strict compilation passed. Actual complete `npm test`, Angular `build:ui`, Rust/Tauri compilation, macOS/WebKit and Windows/WebView2 visual/graphics tests were **not run**.

## Native review gate

On a supported Windows 11 x64 test machine, confirm CSS and actual WebGL buffer dimensions at 100%, 125%, 150% and 200% display scaling; then resize panels, switch modes, export synthetic PNG, and move the window between monitors with different DPRs. Observe whether the stage size recalculates without an ordinary resize and measure memory/graphics context stability. Review upstream renderer pixel-ratio behavior before declaring this fully integrated.

**Architecture / privacy / licensing / release:** Angular layout-only. No new native command, backend/auth/sync changes, third-party assets, licensing change, GitHub Actions, production access, repository visibility change, release, deployment or main merge. Keep this branch as a draft pending review and cross-PR reconciliation with the overlapping Angular UI branches.
