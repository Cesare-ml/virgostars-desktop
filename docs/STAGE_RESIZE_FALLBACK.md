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

## Reentrant cancellation and teardown (14 November 2026)

A WebView animation driver or test adapter can synchronously invoke component
teardown or another panel refresh from `cancelAnimationFrame` or frame registration.
Previously `StageLayoutRefresh.request()` could schedule a new frame *after*
its owner had been disposed, and an outer reentrant request could overwrite a
more recent inner request. The scheduler now checks ownership again after
cancellation and after registering each frame. Any valid returned frame handle
that is already stale is best-effort cancelled; late callbacks remain gated by
generation and disposal state even when cancellation fails.

Three focused regression tests cover disposal during cancellation, nested
request during cancellation, and disposal during frame registration. This is
defensive browser/host lifecycle hardening, not evidence of a Windows crash.
It does not change CSS calculation, native IPC, network, persistence or
renderer internals. Run the focused Node tests and the full Windows GUI suite
before merging.

## Stale frame registration failures must not overwrite newer requests

A frame driver can synchronously trigger a second panel refresh during the first
`requestAnimationFrame` call and subsequently return an invalid handle or
throw. Previously the older outer registration's failure handler reset the
shared generation/phase unconditionally, invalidating the newer pending frame.
A real Node regression test reproduces both failure variants, with both cases
failing on the prior exact GitHub helper blob.

The `arm()` failure branches now reset scheduler state **only when their own
ticket and phase still own it**. A more recent nested request retains its
valid handle and completes both deferred layout frames. Errors remain scoped,
callbacks remain inert after teardown, and the public Angular API does not
change.

Locally validated in an isolated mirror using Node 22.16.0:
`node --experimental-strip-types --test tests/stage-layout-refresh.test.mjs tests/stage-resize-monitor.test.mjs tests/stage-reentrant-driver.test.mjs`
(**28/28 tests pass**). The module also passed standalone TypeScript strict
no-emit checking. The local source and existing two test files matched their
GitHub blob SHA-1 exactly; the original Angular component was represented by
a small static source fixture for the existing one-file wiring contract test,
with actual GitHub Angular wiring previously checked independently.
Not a full checkout's `npm test`, Angular build, native Windows test, or
WebView2/GPU acceptance.


## Integrated CSS diagnosis + WebView2 resize fallback regression (14 November 2026)

The focused Node integration suite now exercises the **unchanged actual** WebView
resize monitor and main-branch `probeDesktopLayout` helper together. Synthetic
DOM styles and dimensions, an injected missing-`ResizeObserver` environment,
and deterministic two-frame scheduler cover:

1. A healthy CSS probe followed by a collapsed chart stage and a recovered stage.
2. A rapid panel change between frames where late obsolete notifications cannot
   publish an intermediate result.
3. A canvas backing-buffer collapse and recovery via fallback notifications,
   including no further events after listener disposal.

It runs without a browser, native executable, network, licensed city pack,
private birth data or actual WebGL renderer. The tests do **not** establish
that Windows WebView2 applies CSS or draws pixels.

Exact GitHub blob parity was confirmed in a local isolated mirror:
`src/app/stage-resize-monitor.ts` `b72a4035747f1edd62ea3ce4daf0aef9e6ad7a70`,
`src/app/desktop-layout-probe.ts` `6058c8026ec67a76b511ead499e920451b56c4fc`,
and new `tests/stage-layout-diagnostic-integration.test.mjs`
`e44bdb2a6c19fb1d89dfb5879d1b68efdc2edb9c`.

```sh
node --experimental-strip-types --test tests/stage-layout-refresh.test.mjs tests/stage-resize-monitor.test.mjs tests/stage-reentrant-driver.test.mjs tests/stage-layout-diagnostic-integration.test.mjs
tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/stage-resize-monitor.ts src/app/desktop-layout-probe.ts
```

**Result:** 31/31 Node 22.16.0 tests passed, with the pre-existing Angular
source-contract test running against a limited synthetic fixture in the
isolated mirror rather than the full Angular component. Both actual pure
TypeScript helpers passed strict compilation. Full checkout `npm test`,
Angular/Charts/Tauri compilation and real Windows 11 native acceptance remain
unverified. No dependency, native permission, runtime source, or main-branch
change was made.


## Deterministic two-frame scheduler model (14 November 2026)

A new `tests/stage-layout-scheduler-model.test.mjs` regression file exercises
the **real** `StageLayoutRefresh` helper with a seeded pseudo-random model.
Its 64 reproducible event traces each cover 96 actions (6,144 steps total),
interleaving panel requests, individual animation frames and late delivery of
canceled callbacks. The independent reference model requires **two new frames
after the most recent toggle**, at most one pending live frame, no orphaned
frame at completion and no post-disposal publication. A second test explicitly
disposes the component between the first and second frames. These synthetic
tests do not depend on timers, a browser, WebView2 or real astrology data.

Verification using the actual **Node 22.16.0 test runner** on exact Git blob
copies in the isolated mirror:
```sh
node --experimental-strip-types --test tests/stage-layout-refresh.test.mjs tests/stage-resize-monitor.test.mjs tests/stage-reentrant-driver.test.mjs tests/stage-layout-diagnostic-integration.test.mjs tests/stage-layout-scheduler-model.test.mjs
```
**33 tests passed, 0 failed, 0 skipped**. The new regression source has
Git blob `450a241506d4fdf85cc18c8c365dee56d5339b93`, identical to the
locally executed file. The pure helper/previous test files also retain their
previously verified matching Git blobs. Both unchanged pure TypeScript helpers
passed strict standalone `tsc --noEmit`. This is not a complete
repository `npm test`, Angular/Charts compilation, native Tauri/Windows
build or WebView2 visual acceptance. One older Angular static source contract
continues to rely on a local fixture in this isolated mirror.
