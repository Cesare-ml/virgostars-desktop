# Angular critical CSS vs Tauri CSP — Windows display fix

**Status: proposed focused source fix, 2026-11-11. The first Windows executable has run, but its CSS did not visibly apply. The fixed native binary has not yet been rebuilt or validated on Windows.**

## Root-cause hypothesis supported by upstream documentation

Angular 20's production application builder enables **critical CSS inlining by default**. That optimization commonly defers the complete stylesheet with a link like this:

```html
<link rel="stylesheet" href="styles-XXXXX.css" media="print" onload="this.media='all'">
```

A strict `script-src 'self'` Content Security Policy prevents the inline `onload` event handler from running. The stylesheet may exist in the bundle while its `media` remains `print`; Angular still bootstraps, but the window renders like plain HTML. This is a strong explanation for the observed small chart and unstyled Tauri WebView2 window, **not yet confirmed against the exact Windows-generated `index.html` or a WebView2 console trace**.

References:
- [Angular security guide — Avoid inline scripts](https://angular.dev/best-practices/security)
- [Angular workspace configuration — optimization.styles.inlineCritical](https://angular.dev/reference/configs/workspace-config)
- [Angular CLI issue #32522 (February 2026)](https://github.com/angular/angular-cli/issues/32522)
- [Tauri 2 CSP guidance](https://v2.tauri.app/security/csp/)

## Change

`angular.json` now configures the desktop production build:

```json
"optimization": {
  "scripts": true,
  "styles": {
    "minify": true,
    "inlineCritical": false
  },
  "fonts": false
},
"subresourceIntegrity": false
```

The complete locally bundled `styles*.css` remains an ordinary render-blocking stylesheet. This may marginally delay first paint, but favors a reliable offline app and avoids the inline event handler. `fonts:false` also prevents the Angular builder from trying to inline CSS fetched from a font provider. The application uses a system-font fallback stack and no externally hosted stylesheets.

**Tauri's CSP remains unchanged.** No `script-src 'unsafe-inline'`, no insecure WebView flags, and no disabling of Tauri's CSP asset transformation.

`scripts/verify-bundled-css.mjs` now **rejects** stylesheet links containing inline event handlers or incompatible `media="print"` attributes, so `npm run verify:css` and `npm run build:ui` fail if Angular reintroduces deferred-CSS behavior. The previous test only checked whether a CSS file existed.

Tests added:
- Regression cases for `media="print" onload=...`, print-only link, unsafe `onerror`, and valid `media="screen"`.
- Source configuration tests for `inlineCritical: false`, safe local CSS loading, non-inlined fonts, and an unchanged restrictive Tauri CSP.

## Rebuild and acceptance on Windows 11

Before switching branches, save local work and check `git status --short`. From this stacked branch:

```powershell
cd D:\GitHub\virgostars-desktop
npm.cmd test
npm.cmd run build:ui
npm.cmd run verify:css
Select-String -Path .\dist\desktop\browser\index.html -Pattern 'media="print"','onload='
npm.cmd run tauri:build
.\src-tauri\target\release\virgostars-desktop-spike.exe
```

**Expected:** `npm.cmd run build:ui` and `verify:css` pass; `Select-String` finds no deferred print/onload CSS in the generated index; the rebuilt Windows application shows a 60px header, dark left navigation, central large chart and right inspector. The footer's CSS runtime status from PR #17 should read `CSS: stili e grafico OK` (or explain a remaining issue).

If the app is still plain, capture the CSS status, a screenshot and the `Select-String` output. Then investigate real WebView2 stylesheet loading and CSP console diagnostics; **do not weaken the CSP as a workaround**.

## What is not claimed

The authoring environment cannot compile this Tauri/Windows build. A successful source test or JavaScript unit test does not prove WebView2 applied component CSS; the native smoke test and accessibility, PNG export and offline behavior must still be retested.

No account data, production service, private artwork, astronomy algorithms, database, GitHub Actions, main-branch merge, signing, public release or license change is involved.
