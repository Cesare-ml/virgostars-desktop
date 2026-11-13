# Fail closed on missing native runtime deadline handles

Status: **focused prototype hardening**, native Windows IPC acceptance pending.

## Why

The read-only `desktop_runtime_info` health probe must install a bounded
deadline before dispatching Tauri IPC. The scheduling code already rejects
exceptions and immediately fired timers, but previously treated a scheduler
returning `null` or `undefined` as if it had successfully registered a
cancellable timer. An invalid injected/custom scheduler could then dispatch
an unbounded native probe; `clear(null)` would not provide reliable cleanup.

## New contract

- After `RuntimeProbeTimers.set` returns, require a non-nullish timer
  handle **before** queueing `transport.invoke('desktop_runtime_info')`.
- A missing handle returns the generic `native_unavailable` status without
  native IPC and without forwarding sensitive exceptions to Angular.
- Handle **0 is valid** (browser timer IDs can be zero), and is cancelled
  normally when the probe finishes.
- Late callbacks from a broken scheduler that did not provide an ID remain
  observed through the pre-existing deadline promise handler; they cannot
  initiate a new native invocation.
- No change to the 4,000 ms default or 30,000 ms test upper bound, the
  read-only native command, browser-preview bypass, or response schema.

This does not verify scheduler honesty, guarantee cancellation of a broken
driver that returned no handle, cancel an already-dispatched Tauri operation,
or prove any account/astronomy readiness.

## Review and acceptance

Focused regressions are in `tests/native-runtime.test.mjs`: null and
undefined timer handles suppress dispatch, and zero remains valid/cleaned.

```powershell
node --experimental-strip-types --test tests/native-runtime.test.mjs
npm test
npm run build:ui
```

Windows 11 WebView2 still needs real startup/timeout/offline testing; native
Cargo/Tauri and upstream Charts compilation also remain independent gates.
No GitHub Actions, public release, main merge, account/production service,
private catalog, secrets, or new dependencies are involved.
