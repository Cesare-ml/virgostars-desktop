# Chart busy state and accessible status text

**Status: UI-only prototype fix.** No native Windows/WebView2 acceptance has been completed for this change.

## Observed problem

The chart-stage busy overlay used the hard-coded translation key
`chart.loading` whenever `busy` was true. PNG export also sets `busy=true`,
but the component's live state switches to `status='exporting'`.
During export the screen therefore misleadingly announced/rendered
"Rendering…" instead of "Exporting…". The overlay and toolbar both used
`role="status"`, producing two live announcements of the same transition
for assistive technology.

## Narrow change

- The visually displayed overlay now uses `{{t(status)}}`, the existing,
  localized component state. The toolbar continues displaying that state.
- The overlay is marked `aria-hidden="true"`; it is visual-only and not a
  second live region. The existing toolbar `role="status"` is retained as
  the single announcer for rendering/exporting/exported state.
- The existing `role="alert"` for renderer errors remains untouched.
- No changes to the renderer, export timing, PNG bytes, save/download claims,
  native IPC, account data, accessibility roles outside the chart progress
  overlay, or translations.

This does not prove that a browser accepted or saved a requested PNG.
It only makes the in-app progress description accurate.

## Verification

Focused static-contract tests:

```sh
node --experimental-strip-types --test tests/chart-status-overlay.test.mjs
npm test
npm run build:ui
```

The regression checks ensure the overlay follows the component's current
render/export status, has no redundant live region, retains the accessible
toolbar/error announcements, and uses distinct IT/EN status messages.

**Before merging:** run the full Node/Angular checks with the compatible
public Charts dependency. In Windows WebView2, start a synthetic draw and
a PNG export and verify the visible text changes to "Esportazione in corso…"
(or "Exporting…") during export, without duplicate screen-reader
announcements. Test screen readers and offline behavior explicitly. Also
reconcile any concurrent PRs changing `desktop-app.component.html`.

No real birth records, external datasets, credentials, unapproved artwork,
production/backend access, new dependencies, GitHub Actions, release,
visibility changes or direct `main` merge.
