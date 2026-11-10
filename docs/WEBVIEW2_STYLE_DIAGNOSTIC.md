# WebView2 CSS runtime probe — Windows visual diagnostics

**Status (2026-11-10): Implemented in a stacked draft PR, pure TypeScript tests locally verified; native Windows/WebView2 test still pending.**

## Why it exists

The maintainer has successfully built and launched the first experimental Windows 11 `.exe`. Angular renders, the synthetic chart is visible and the Tauri read-only IPC answers. However, the screenshot shows almost no application styling and a tiny astrological wheel.

The preceding [CSS packaging gate](WINDOWS_GUI_SMOKE_2026-11-10.md) verifies the presence of a local `styles*.css` file in the Angular build. That is necessary but **not sufficient**: WebView2 could still fail to apply the stylesheet, Angular component styles could fail independently, or a valid layout could produce an undersized canvas.

This probe adds **runtime evidence** rather than disabling CSP or replacing the chart-first design.

## What was implemented

- `src/styles.css` sets a harmless CSS custom property `--vs-global-css-marker: ready` on `:root`.
- `src/app/desktop-app.component.css` sets `--vs-component-css-marker: ready` on `.desktop-app`.
- `src/app/style-health.ts` reads only these expected values, computed grid display, the chart-stage bounding rectangle and the canvas bounding rectangle. It does not enumerate stylesheet contents, URLs, filenames, local device identity or personal data.
- `DesktopAppComponent` checks after two animation frames, reruns after chart-stage resize and theme changes, and offers a user-triggered retry button. Pending animation frames are canceled on component destruction.
- A compact, accessible text indicator in the existing footer is always present. When CSS is missing, the indicator still appears as plain HTML text because it does **not** depend on CSS to exist.
- IT/EN translations explicitly distinguish the following statuses:

| Status | What it means |
| --- | --- |
| `ok` | Both expected style markers, grid layout and canvas size look normal |
| `both_missing` | Global and component CSS markers are absent |
| `global_missing` | Global marker absent; component marker present |
| `component_missing` | Component marker absent; global marker present |
| `layout_unexpected` | CSS markers present but grid layout or stage dimensions invalid |
| `canvas_small` | CSS appears present, but canvas occupies too little of a large chart stage |
| `unavailable` | DOM style inspection failed; no browser exception details are printed |
| `checking` | Measurement scheduled or retry requested |

This **does not** prove correctness of the astronomical chart, imported asset rights, full offline isolation, GPU recovery or accessibility. It diagnoses observed layout symptoms.

## Windows QA procedure

On a checkout with this branch applied:

```powershell
cd D:\GitHub\virgostars-desktop
git status --short
npm.cmd test
npm.cmd run build:ui
npm.cmd run verify:css
npm.cmd run tauri:build
.\src-tauri\target\release\virgostars-desktop-spike.exe
```

Read the footer `CSS:` status and click the adjacent **⟳** button once after startup. Take a screenshot. Compare with the ordinary Angular browser preview (`npm.cmd start`) if needed.

- `both_missing` or `global_missing`: inspect WebView2 CSS resource loading, embedded stylesheet references and browser CSP violations.
- `component_missing`: inspect Angular component style injection and the production CSP, keeping restrictive Tauri protections.
- `layout_unexpected` or `canvas_small`: inspect actual bounding rectangles and resize timing before changing the layout or the renderer.
- `ok` despite visually unstyled UI: this would show our marker tests are insufficient; inspect computed CSS properties and browser rendering more deeply, not declare success.

Official Tauri security guidance states that CSP is injected into bundled HTML and nonces/hashes are added for local frontend assets: https://v2.tauri.app/security/csp/ . **Do not disable CSP**, use remote CSS/CDNs, or enable insecure Tauri APIs as a workaround.

## Tests and limitations

- `tests/style-health.test.mjs` contains 11 tests (10 pure DOM/style classification cases and one repository source/wiring contract).
- **10/10 pure classification/DOM tests passed locally** using Node.js 22.16.0 and the exact committed TypeScript helper file (matching Git blob SHA).
- Standalone `tsc --noEmit --strict` of the helper **passed** with TypeScript 5.8.3.
- The extra repository source/wiring test, complete Angular `ng build`, actual WebView2 stylesheet load and new Windows executable have **not** been executed after this patch; record them separately.
- Tests use mocked DOM sizes and do not simulate graphics processing or privileged native IPC.

No production changes, public repository publication, account synchronization, GitHub Actions, license decision, automatic merge or release. This branch follows the dedicated CSS packaging gate draft PR #16.

## Potential root cause identified: Angular critical CSS optimization

Angular production builds may emit `<link rel="stylesheet" ... media="print" onload="this.media='all'">`. Tauri's strict `script-src 'self'` can block that inline event handler. The follow-up [Angular CSP CSS Fix](ANGULAR_CSP_CSS_FIX.md) disables Angular `inlineCritical` and updates the bundle verifier to reject this deferred link rather than changing Tauri permissions. This is a plausible cause, not yet verified against the user's generated `index.html` or rebuilt Windows executable.
