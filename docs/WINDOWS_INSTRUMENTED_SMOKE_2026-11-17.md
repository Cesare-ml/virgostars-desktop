# Instrumented Windows smoke — 2026-11-17

Status: **Locally tested** on one Windows 11 x64 machine. This is not a release test, not an installer test and not an astronomy validation.

## What was added

`npm run smoke:native` ([script](../scripts/smoke-windows-instrumented.mjs)) launches the fixed-path release executable, attaches to its WebView2 through a loopback-only DevTools port and records measurements that the manual runbook ([Native smoke runbook](WINDOWS_NATIVE_SMOKE_RUNBOOK.md)) can only ask a human to eyeball:

- the global stylesheet is actually applied (rule count above zero), the sidebar, chart canvas and inspector have a real size;
- no horizontal or vertical page overflow at 1280×720 and 1920×1080;
- a WebGL context exists and is not lost;
- the demonstration label is visible while no calculation is shown;
- every request the page made stayed on `tauri.localhost`, `ipc.localhost`, `data:` or `blob:`; no page exceptions;
- the read-only IPC commands answer: `desktop_runtime_info` reports a synthetic fixture with no account and no sync; `calculate_chart` answers `provider_unavailable` (default build) instead of inventing positions, and rejects a malformed request;
- "Export PNG" produces a file with a valid PNG signature of plausible size;
- the WebGL context survives a forced loss and restore.

It uses a throw-away WebView2 profile and download folder in the OS temp directory (removed afterwards), takes no screenshots, calls no archive command and prints no absolute paths. The decision logic is a pure function covered by `tests/windows-instrumented-smoke.test.mjs`; the launch itself is not part of `npm test` because it opens a window.

## Result on the maintainer machine

Executable built with `tauri build --no-bundle` from the verified synthetic bundle, default features (no Swiss provider). `npm run smoke:native` ended with no failures: 83 requests, all local; 0 page exceptions; PNG export 304 200 bytes; calculation status `provider_unavailable`.

Manual-runbook items this covers only in part: the machine stayed online during the run, so "works offline" is supported by "no external request was attempted", not by a disconnected network. Visual quality (themes, tabs, chart readability) was inspected on two screenshots by hand; there is no automated visual regression.

## Finding: Tauri IPC is blocked by `connect-src 'self'`

The page's CSP is `connect-src 'self'`. On Windows Tauri's fast IPC path goes to `http://ipc.localhost`, which that policy refuses; every command logs a CSP violation and a "IPC custom protocol failed" warning, then Tauri falls back to its `postMessage` channel. The commands **do work** (checked above), so this is noise and some overhead, not a functional failure. The smoke reports it as the warning `IPC_CSP_FALLBACK`.

Tauri documents `ipc: http://ipc.localhost` as the allowance for that channel. It was **not** added: the CSP is pinned by the security gates and `docs/TAURI_PRODUCTION_SECURITY_GATE.md`, and widening it is a maintainer decision.

## Still open for the MVP

- Real astronomical output: only the optional local-use Swiss provider exists; the canonical VirgoStars-Ephemeris provider is not integrated.
- The chart archive is an unencrypted SQLite file; account and cloud sync are not implemented.
- No installer, no signature, no updater; the executable was only run from the build directory.
- Many unmerged stacked branches overlap `main`; none was merged here.
