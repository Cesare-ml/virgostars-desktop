# Chart stage resize fallback (prototype)

**Scope:** Synthetic-only Angular/Tauri chart layout. No astronomy, birth records, permissions, native IPC, network or filesystem access.

The chart first attempts `ResizeObserver` on its own stage, as before. Some constrained WebViews can throw during construction or observation. Previously this prevented the initial `draw()` call and placed the workspace in a generic renderer-error state even when the Three.js chart itself could draw.

`watchChartStageResize` now contains this setup boundary. If construction or observation fails, it disconnects any partially attached observer and falls back to a `window.resize` listener. If even the fallback is unavailable, the app can still perform its first chart render at its initial measured size. The teardown callback is idempotent and guards late notifications after destruction; cleanup failures are contained. Transient exceptions in the UI resize handler are also contained so that an otherwise working observer is not mistaken for a broken implementation and later notifications can still refresh the layout. Fallback switches callback ownership before disconnecting an abandoned observer: late or reentrant notifications from the discarded observer cannot trigger duplicate chart updates. A partially attached window listener is also removed best-effort if registration throws.

**Panel changes:** Both navigation and inspector toggles request one coalesced layout measurement after **two animation frames**. This lets Angular render changed CSS classes before the stage is sampled, even when only `window.resize` is available. The refresh is cancelled when the Angular component is destroyed, and ignores invalid scheduler handles, late callbacks and transient measurement exceptions.

**Tradeoff:** A window-only listener still cannot detect *arbitrary* parent/container size changes that neither resize the window nor use the built-in panel toggles. Two animation frames also add a small delay to panel-only resizing. This is a degraded compatibility path, not a replacement for a working `ResizeObserver`. The normal ResizeObserver path is unchanged.

## Checks performed

On Node.js **22.16.0**, an isolated working copy of the new helper and synthetic tests passed:

```sh
node --experimental-strip-types --test tests/stage-resize-monitor.test.mjs tests/stage-layout-refresh.test.mjs
# 21 passed, 0 failed
tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/stage-resize-monitor.ts
# passed (standalone helper)
```

The original 12 cases cover normal observer behavior, unavailable observer, throwing `observe`, unavailable window fallback, cleanup exceptions, idempotent disposal, late callbacks, transient UI callback errors, abandoned observer callbacks after fallback, reentrant observer disconnect notifications, and cleanup of a partially attached window fallback. An earlier iteration's callback isolation tests reproduced failures before being fixed.

The nine additional cases check coalescing, two-frame measurements, disposal during either frame, inaccessible schedulers, bad animation-frame handles, recoverable callback errors and Angular panel wiring. An initial attempt exposed Node 22's unsupported TypeScript parameter properties in strip-only mode; these were removed before the final passing run. A source-contract test used a small isolated fixture of the Angular methods; the actual Angular branch file was separately inspected with nine direct invariants, all passing. The **full Angular build was not run**.

Git object IDs from the passing isolated helper/tests match the GitHub branch: helper `6c18d2f8334e504ecd824f44a62b3aa40934496a`, original tests `c55ca157299879ca957f54375cadc361b7765a19`, new tests `2b07b43c93da1066516d5e79d1604efad9f3cf6b`. TypeScript verification used compiler version 5.8.3; tests used Node 22.16.0.

**Not executed:** repository-wide `npm test`, Angular `npm run build:ui`, the complete sibling Charts dependency, native Tauri/Rust build, WebView2 browser smoke or actual panel-resize acceptance. Test on Windows with the normal observer path and a simulated failure path; verify initial draw and window-resize responsiveness. The fallback is intended to keep chart initialization alive, not to prove drawing or image exports.

This is a separate draft from pending PNG/clock/sidebar changes. Review small overlapping edits to `DesktopAppComponent` before integrating; do not merge automatically or change publication settings. CPAL and VirgoStars attribution remain unchanged.

## Last-toggle-wins panel refresh (14 November 2026)

A second navigation/inspector click can arrive *between* the two scheduled
animation frames. In that case the previous coalescer kept the already queued
second frame, which could measure before Angular had rendered the **last** CSS
class change. `StageLayoutRefresh.request()` now invalidates the old ticket,
best-effort cancels its pending frame and starts a fresh pair of frames after
the most recent click. A failed `cancelAnimationFrame` cannot restore the
invalidated callback. Rapid toggles still leave at most one live refresh
request; measurement is postponed until two frames after the latest toggle.

Two focused tests cover a second click between frames and a failed cancellation
with an already queued stale callback. Real Windows WebView2 timing and full
Angular build remain to be verified. No native permissions, network, personal
data or renderer changes are introduced.
