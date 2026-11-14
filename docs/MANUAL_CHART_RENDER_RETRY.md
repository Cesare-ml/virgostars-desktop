# Manual chart redraw recovery (synthetic Desktop)

**Status:** implemented on a draft branch, native Windows/WebView2 acceptance pending.

## User experience

After a *completed* chart drawing attempt has failed, an initialized Desktop
chart can display **Riprova il disegno / Retry chart rendering** in the chart
toolbar. Activating it explicitly reuses the existing `draw()` code path:
the current fictional chart mode and theme are passed through the usual
`RenderGeneration` latest-only guard, with no new Tauri commands or network
requests. On retry, the previous error is cleared, the loading state resumes,
and the control disappears while rendering; it returns if the attempt fails.

The control is guarded by the pure `canRetryChartRender()` helper: it only
appears when the renderer has initialized, the component is alive, no draw or
export is running, the chart is not already ready, and an error is visible.
Clicking the action after the state has changed is independently guarded.
There is no timer, loop, background retry, refresh request, or credential
handling. The UI keeps the existing CPAL attribution.

## Boundaries

This is a **manual retry of an existing synthetic chart**, not WebGL context
restoration. Failures **during renderer initialization** cannot be safely
recovered through an unverified second initialization; the button stays hidden
in that case, and the existing error remains visible. If the GPU, WebView2,
asset pack or renderer is persistently broken, a retry may fail again and will
not fake a ready state. The source deliberately makes no claim that this can
recover from WebGL context loss.

The existing export path may use the same generic render-error state on
failure; a manual redraw can restore the chart in that case, but this does not
replace the dedicated pending export-state fix in separate PR #206. This
change does not modify PNG validation, storage, astronomical calculations,
account login, native IPC or cloud sync.

## Tests and manual acceptance

From a clean authorized checkout:

```powershell
node --experimental-strip-types --test tests/chart-render-retry.test.mjs
npm test
npm run build:ui
```

The six tests cover the accepted state, blocking while busy/exporting,
success/destruction/partial startup, fail-closed malformed flags, Angular
button wiring and IT/EN labels. TypeScript can be checked independently:

```powershell
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler src/app/chart-render-retry.ts
```

On a Windows 11 WebView2 build, simulate an **in-flight draw failure** from a
reviewed development stub (not a production backend). Verify the retry
control appears only after the failure, disappears on click, cannot double
submit, and a successful retry recovers the visual scene. Test keyboard/screen
reader behavior, Italian/English, high-contrast/light/dark themes, teardown,
and persistent-failure cases. Initialization failures should not offer retry.
Do not bypass CSP or grant native permissions to fake a failure.

The focused helper's Node tests and strict TypeScript compilation alone do
not prove the real Angular template, renderer state or native WebGL behavior.

## Integration

This PR touches `desktop-app.component.ts`,
`desktop-app.component.html`, and `translations.ts`, which are also changed
by several independent UI drafts, including #211. Reconcile those small hunks
before any merge and run the full checkout and native Windows gates. No
protected city data, birth records, private assets, GitHub Actions, source
visibility changes, installers, signed updates or production services.
