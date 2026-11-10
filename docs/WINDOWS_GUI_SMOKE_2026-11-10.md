# First Windows UI smoke test — 2026-11-10

**Status: Windows binary launched; Angular/Rust IPC and a synthetic WebGL chart were observed by the maintainer. The visual layout is NOT yet correct.**

## Observed behavior

The maintainer compiled and opened a Windows `.exe` under Tauri 2. The running window displayed the desktop Angular chart UI, an actual small synthetic astrological wheel and a native status string indicating **Tauri demo mode**. This confirms a first native GUI smoke test and a successful enough runtime bridge for the read-only local capability probe.

However, the entire window appeared very close to **browser default HTML styling**: missing design grid, panels, colors, spacing, typography, and large centered chart. The tiny wheel is consistent with CSS/layout rules not being applied, but a screenshot alone does **not** identify whether the reason is missing CSS in Angular output, a stylesheet reference/loading failure, a WebView2 CSP rejection, or another native packaging issue. No production data was accessed.

## Confirmed test gap

The original `verify-offline-bundle.mjs` checks the Angular root and every synthetic image hash, but did not check for a stylesheet. Therefore a visually unstyled output could pass the packaging test. The new `scripts/verify-bundled-css.mjs` verifies that the Angular-generated index links a **local** global stylesheet, the referenced file exists as an ordinary file, and it includes the desktop app root and box-sizing rules. `verify-offline-bundle.mjs` now requires this verification. The new `npm run verify:css` command can inspect an already-built local Angular bundle. Neither the CSS checker nor the earlier asset verifier proves that WebView2 loads the stylesheet.

This change does **not** relax the Tauri CSP, use remote CSS, change themes, add a network fallback, embed private artwork, or modify the scientific renderer.

## On the maintainer's Windows 11 PC

From the branch containing this fix:

```powershell
cd D:\GitHub\virgostars-desktop
git status --short
git pull --ff-only
npm.cmd run verify:css
Get-ChildItem .\dist\desktop\browser\styles*.css | Select-Object Name, Length
```

**Interpretation:**
- A failing `verify:css` or no `styles*.css` means Angular output is incomplete or the CSS link is wrong. Rebuild Angular and inspect its logs.
- A passing `verify:css` plus still unstyled native UI means the file exists in the desktop bundle but may not be loading *inside WebView2*. Compare `npm.cmd run start` in a normal browser with `npm.cmd run tauri:dev` in a second terminal. Diagnose actual CSP/network errors; do **not** disable the CSP or load external styles to mask the symptom.
- If both browser and native preview are correctly styled but the release `.exe` is plain, review native embedded asset paths, compile-time Tauri CSP, the exact `src-tauri/target/release` binary, and whether it was rebuilt after the latest Angular output.

## UI acceptance checklist still open

- [x] Native `.exe` launches on Windows 11 and the Angular synthetic scene becomes visible.
- [x] Runtime footer shows a native Tauri demo state (not an authenticated account).
- [ ] Global stylesheet actually applied inside WebView2.
- [ ] Main chart maximized and centered, with left navigation and right inspector.
- [ ] Light and dark themes visually correct.
- [ ] Four chart modes, zoom/fit, export PNG and keyboard checks.
- [ ] Runtime CSS load confirmed without disabling security restrictions.
- [ ] Offline execution without dev server and unexpected network requests.
- [ ] MSI/NSIS, code signing and distribution (intentionally out of scope).

No merge, publishing, production change or GitHub Actions as part of this smoke-test fix.

## Follow-up: runtime CSS probe

A separate stacked draft adds a footer status for the **actually computed** global and component CSS markers and chart geometry, with an accessible recheck control. See [WebView2 Style Diagnostic](WEBVIEW2_STYLE_DIAGNOSTIC.md). This instrumentation is not yet evidence of a visually fixed Windows release.
