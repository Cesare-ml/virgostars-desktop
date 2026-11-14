# Device-clock visibility lifecycle (prototype)

Status: **implemented in the synthetic Angular shell, pending Windows/WebView2 smoke verification**.

## Intent

The device and selected-city clocks are **civil-time display only**. Their values never change chart positions, birth records, UTC resolver inputs, authentication or the astronomy provider.

The Desktop component subscribes to `document.visibilitychange` exactly once during view initialization and removes the handler during destruction:

- **Visible (or visibility unknown):** start the clock, sampling `Date.now()` immediately. Repeated starts do not create extra intervals.
- **Hidden:** cancel the one-second interval without invalidating the last displayed reading. A hidden display is not promised to be current.
- **Visible again:** restart with a fresh wall-time sample. An OS sleep or clock adjustment cannot be misinterpreted as elapsed intervals.
- **Repeated Angular rendering:** the UI reuses the full and compact formatted strings for the same timestamp and locale, avoiding repeated `Intl.DateTimeFormat` allocations while keeping time and language changes reactive.
- **Destroyed:** cancel the interval, detach the document listener and ignore callbacks.

`DeviceClock.pause()` uses a generation counter, so a callback queued before the timer was cancelled cannot update the view, including **after** a new interval is registered. A scheduler that synchronously pauses during registration must have its returned handle cancelled. If that scheduler then throws or returns no timer handle, the obsolete start must **not** replace the paused clock's last displayed time with an unavailable value. Exceptions from timer cancellation remain contained; clock readings remain non-sensitive and are never logged.

This is a **best-effort power-saving** feature: whether a minimized Tauri/WebView2 window emits `visibilitychange` is host-dependent. If it does not, the existing one-second interval remains the fallback, and its sampled wall time remains correct. A separate native window-focus event may be considered after actual Windows and macOS acceptance testing.

## Verification

Run from the desktop repository with Node.js 22.12+ (or Node 24+):

```sh
node --experimental-strip-types --test tests/device-clock.test.mjs tests/device-clock-visibility.test.mjs tests/device-clock-paused-scheduler.test.mjs tests/device-clock-text-cache.test.mjs
npm test
```

Synthetic tests cover a hidden-window pause, immediate resume, pre-cancel callbacks arriving late, synchronous pause during schedule registration, idempotent disposal and hostile cancellation.

No new storage, native commands, permissions, remote requests, dependencies or third-party assets are introduced. No production changes or scientific accuracy claims are made.

## Throwing UI observer safety (2026-11-14)

A UI render/notification callback may throw while the clock samples a new wall time or marks an invalid timestamp. The clock now routes both notifications through `emitChanged()`, containing observer failures while continuing to schedule ticks and preserving the **already-written** timestamp. This is a small backport from the combined Desktop integration PR #239 and follows the separately reviewed observer-safety PR #133.

`tests/device-clock-observer-lifecycle.test.mjs` adds five pure Node regressions: throwing startup callback, invalid-time recovery, throwing callback during scheduler retry, disposal during first refresh, and hidden-window pause/resume with a throwing observer. **5/5 passed locally on Node 22.16.0**, along with the other **16/16** isolated clock/runtime checks when tested together. The published module and test Git blob SHAs match the executed local mirror. Full-checkout `npm test`, Angular build and Windows WebView2 verification remain outstanding.

No account/sync/astronomy capabilities, native permissions, network calls, storage or new dependencies are introduced. Do not merge the overlapping clock changes from #236 and #239 twice.
