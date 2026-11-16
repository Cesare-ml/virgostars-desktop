# Manual chart redraw recovery

**Status:** implemented on a current-main feature branch; Angular and Windows/WebView2 acceptance pending.

## Behavior

After the renderer has initialized and a chart draw has completed with an error, the toolbar offers **Riprova il disegno / Retry chart rendering**. It is a user-triggered action and calls the existing `draw()` method. The normal `RenderGeneration` ticket still owns asynchronous completion, so stale draws cannot replace current UI state.

The action is available only when the renderer is initialized, the component is alive, no draw or PNG export is active, the chart is not ready, and an error is visible. The click handler checks the same gate again. A retry clears the previous error and enters the ordinary loading state; a second click is unavailable while that draw is active.

## Explicit limitations

- This does not reinitialize the renderer after initialization failure.
- It does not restore a lost WebGL context or repair GPU/WebView2/asset failures.
- It adds no timer, polling, automatic retries, native IPC, network request, persistence, or astronomy.
- A persistent render failure may fail again; the UI must never report success unless the existing renderer completes successfully.
- A separate `lastDrawFailed` state is set only by the current draw's failure, cleared at the start of each draw. A PNG export error or failed renderer initialization must not expose the redraw action.

## Isolated behavior probe (2026-11-16)

Node.js 22.16.0 executed a locally reconstructed copy of the exact pure `canRetryChartRender` helper shown in this PR: **64/64 boolean combinations** and **12/12 null, missing or invalid-state probes passed**. The probe was not run from a repository checkout, did not execute the committed `tests/chart-render-retry.test.mjs` file, and did not load Angular or WebView2. This evidence is narrower than a passing `npm test` or native build and must not be used to mark those gates complete.

## Verification

Run on a complete authorized checkout:

```powershell
node --experimental-strip-types --test tests/chart-render-retry.test.mjs
npm test
npm run build:ui
```

Then in a Windows 11 WebView2 build, verify failure after successful initialization, retry success, repeated retry failure, double-click prevention, export overlap, component destruction during an in-flight retry, keyboard activation, screen-reader naming, Italian/English and light/dark themes. A failed initialization must not display the retry control.

Pure helper/source tests and an Angular compile do not replace this native GUI acceptance. No installer, release, merge to `main`, GitHub Actions, production data, or private chart records are part of this change.
