# Manual chart redraw recovery

**Status:** implemented on a current-main feature branch; full checkout and Windows WebView2 acceptance pending.

## Behaviour

After a completed chart draw fails, the toolbar offers **Riprova il disegno / Retry chart rendering**. The action reuses the existing `draw()` path and its `RenderGeneration` latest-request-wins guard. Starting the redraw clears the prior error and returns the UI to its normal loading state.

The button is available only when the renderer has initialized, the component is alive, no draw or export is active, the chart is not ready, and a visible render error exists. The click handler checks the state again before dispatching.

## Explicit limitations

- This retries a draw on an already initialized renderer. It does not reinitialize a renderer whose initialization failed.
- It does not restore a lost WebGL context or fix persistent GPU, WebView2, CSS or asset failures.
- It never retries automatically, polls, creates a timer, or invokes a new Tauri command.
- It does not change astronomical calculations, chart data, persistence, auth, sync, CSP or native capabilities.

## Verification

Run from a complete contributor checkout:

```powershell
node --experimental-strip-types --test tests/chart-render-retry.test.mjs
npm test
npm run build:ui
```

Then on Windows 11/WebView2 test a controlled post-initialization render failure, one successful retry, repeated failure, click while a draw/export is active, component teardown during redraw, keyboard and screen-reader labels, Italian/English, and light/dark themes. Confirm initialization failure never exposes the retry action.

The focused Node tests and strict helper compilation do not prove Angular template compilation, actual WebGL recovery or native GUI acceptance. Do not disable CSP or add native permissions to simulate a failure.
