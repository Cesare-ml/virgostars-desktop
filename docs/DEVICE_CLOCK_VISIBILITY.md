# Device-clock visibility lifecycle (prototype)

Status: **implemented in the synthetic Angular shell, pending Windows/WebView2 smoke verification**.

## Intent

The device and selected-city clocks are **civil-time display only**. Their values never change chart positions, birth records, UTC resolver inputs, authentication or the astronomy provider.

The Desktop component subscribes to `document.visibilitychange` exactly once during view initialization and removes the handler during destruction:

- **Visible (or visibility unknown):** start the clock, sampling `Date.now()` immediately. Repeated starts do not create extra intervals.
- **Hidden:** cancel the one-second interval without invalidating the last displayed reading. A hidden display is not promised to be current.
- **Visible again:** restart with a fresh wall-time sample. An OS sleep or clock adjustment cannot be misinterpreted as elapsed intervals.
- **Destroyed:** cancel the interval, detach the document listener and ignore callbacks.

`DeviceClock.pause()` uses a generation counter, so a callback queued before the timer was cancelled cannot update the view, including **after** a new interval is registered. A scheduler that synchronously pauses during registration must have its returned handle cancelled. Exceptions from timer cancellation remain contained; clock readings remain non-sensitive and are never logged.

This is a **best-effort power-saving** feature: whether a minimized Tauri/WebView2 window emits `visibilitychange` is host-dependent. If it does not, the existing one-second interval remains the fallback, and its sampled wall time remains correct. A separate native window-focus event may be considered after actual Windows and macOS acceptance testing.

## Verification

Run from the desktop repository with Node.js 22.12+ (or Node 24+):

```sh
node --experimental-strip-types --test tests/device-clock.test.mjs tests/device-clock-visibility.test.mjs
npm test
```

Synthetic tests cover a hidden-window pause, immediate resume, pre-cancel callbacks arriving late, synchronous pause during schedule registration, idempotent disposal and hostile cancellation.

No new storage, native commands, permissions, remote requests, dependencies or third-party assets are introduced. No production changes or scientific accuracy claims are made.
