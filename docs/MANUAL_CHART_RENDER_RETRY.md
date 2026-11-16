# Manual chart-render retry

**Status:** implemented on a current-main feature branch; automated project tests and native Windows/WebView2 acceptance remain pending.

## Behavior

When an already initialized chart renderer finishes a draw with an error, the toolbar exposes an explicit **Retry chart rendering / Riprova il disegno** button. It is visible only while the component is alive, not drawing, not exporting, not ready, and holding a render error. The action invokes the existing `draw()` method; it does not construct a second renderer, reinitialize WebGL, or retry native IPC.

The existing `RenderGeneration` token remains authoritative. A later redraw supersedes an earlier one, and teardown invalidates outstanding tokens. The button is a normal keyboard-accessible HTML button with a localized accessible name.

## Deliberate limits

- This is a manual redraw of the existing initialized renderer only.
- It cannot restore a lost WebGL context, recover failed renderer initialization, or repair GPU/driver failures.
- Startup initialization errors remain non-retryable in this patch because there is no proven safe renderer reinitialization lifecycle.
- It does not enable real astronomy, change data provenance, add IPC permissions, or affect exports/storage.

## Verification still required

From a complete authorized checkout with the sibling Charts library installed:

1. `node --experimental-strip-types --test tests/chart-render-retry.test.mjs`
2. `npm test`
3. `npm run build:ui`
4. On Windows 11/WebView2, induce a post-initialization draw failure, use the button by mouse and keyboard, confirm a successful retry clears the error, and confirm a repeated failure remains retryable.
5. Verify teardown during a failed draw, retry while export is active, IT/EN labels, and no retry control during initialization or while busy.

These source changes and synthetic unit tests are not evidence of native WebGL context restoration, Windows acceptance, scientific ephemeris integration, or a distributable release.
