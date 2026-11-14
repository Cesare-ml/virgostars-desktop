# Manual native runtime recheck

Status: **synthetic UI prototype**. Pending TypeScript/Windows/WebView2 acceptance.

## What changes

The Settings inspector now includes a **Desktop environment / Ambiente desktop** row with a manual **Recheck environment / Ricontrolla ambiente** button. This is a local, **read-only** recheck of the existing Tauri `desktop_runtime_info` v1 command, not an account login. The footer continues to distinguish:

- Tauri synthetic demonstration runtime
- ordinary browser preview (no native commands)
- unavailable or malformed native response
- currently checking

The button is disabled while a check is pending; the controller permits only one outstanding check. It can be retried after a failure, is never automatically polled and discards late completions after component destruction. Exceptions from IPC or Angular notification remain contained without logging potentially sensitive native error details.

No new Rust commands, Tauri capabilities, network endpoints, authentication, astronomy calculations or data writes. Only the existing `inspectDesktopRuntime()` adapter and its bounded runtime probe are used. A healthy synthetic desktop runtime **does not** imply a connected account, working cloud sync or verified ephemerides.

## Tests and smoke

```sh
node --experimental-strip-types --test tests/runtime-check-controller.test.mjs
npm test
npm run build:ui
```

On Windows with the synthetic Tauri prototype, open **Parametri / Settings**, verify the status, click the retry button and check that it becomes disabled until the result is displayed. Repeat in a browser preview and with temporarily unavailable native IPC; do not disable CSP or authorize additional native commands to make the status green.

Unit tests exercise success, unavailable→retry recovery, browser preview, duplicate in-flight requests, late results after destroy, exception containment and template wiring. The native Windows GUI smoke is not simulated by these checks.

## Scope and risks

The change adds no dependencies, private data, generated assets or persistent preferences and does not alter the CPAL/NOTICE attribution. It is safe to review independently of the native city catalog and real astronomy providers.
