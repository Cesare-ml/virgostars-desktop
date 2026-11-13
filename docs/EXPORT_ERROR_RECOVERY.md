# PNG export error recovery in the synthetic Desktop shell

Status: **reviewable prototype patch**, not a verified native Windows behavior.

## Problem

The Angular chart component previously routed all PNG export exceptions through
`renderError()`, the handler for an actual chart draw failure. That handler sets
`ready=false`. A PNG validation, browser anchor, or offscreen export failure
could therefore disable zoom and another PNG attempt despite an already rendered
chart remaining on screen. The busy overlay also always said "Rendering" even
while exporting, and a rendering failure left the toolbar with its earlier
"Rendering" status text.

## Narrow correction

- `exportPng()` retains the existing chart's `ready` state if PNG generation,
  validation, or the browser download request throws. It displays a localized
  `export.failed` alert and status and clears the old error on the next attempt.
- The export's `finally` block still releases `busy`/`exporting` and
  preserves the component-destroy guard.
- `renderError()` now sets `status.error` for an actual draw failure; it still
  invalidates chart readiness.
- The busy-stage status uses the current translated status, so an active PNG
  export is called exporting rather than rendering.
- Italian and English have distinct export failure text.
- Source-contract regressions are added to
  `tests/desktop-shell-contract.test.mjs`. These check the Angular state paths
  but do not simulate an actual Tauri/WebView2 download.

## Scope and limitations

This change does **not** establish whether the host OS saved a PNG: a browser
anchor `click()` returning only means a download was requested. It does not
change the size/format validator, image contents, astronomy, local encrypted
storage, authentication, account data, native IPC, network access, licenses,
assets, dependencies or installer. No user records or private city catalog
are involved.

## Reviewer verification

```powershell
node --experimental-strip-types --test tests/desktop-shell-contract.test.mjs
npm test
npm run build:ui
```

In a native Windows WebView2 prototype, export a valid synthetic chart and
induce a failed browser download or invalid PNG result. Confirm the error is
localized and announced, the current chart remains zoomable, a retry is
possible without rerendering, and a successful retry removes the old error.
Separately cause a **chart rendering failure** and confirm the zoom/export
controls remain disabled until the renderer succeeds.

A passing source-contract test does not replace Angular compilation or native
GUI acceptance. Reconcile with other open UI PRs before merging. Do not
publish, merge to main, sign, deploy or change repository visibility without
separate maintainer approval.
