# Active CSS link gate (desktop build artifacts)

**Status: prototype build-time safeguard — not a WebView2 runtime acceptance test.**

The existing offline bundle verifier already requires a local `styles*.css` file, an Angular desktop root and CSS selectors. That check alone can accept an otherwise valid file referenced by an **inactive** HTML stylesheet link.

`inspectDesktopStyles` now fails closed when a linked stylesheet has an HTML `disabled` attribute, carries the `alternate` relationship or supplies a non-`text/css` MIME type. Those cases may leave the Tauri/WebView2 UI unstyled even though the stylesheet is packaged. Ordinary `rel="stylesheet"` with no type (the normal Angular output), or an explicit `text/css` type and `screen`/`all` media, remains accepted. The existing restrictions on remote URLs, CSS file paths, print-only media and CSP-blocked inline event handlers remain unchanged.

Synthetic, isolated regression tests live in `tests/verify-css-enabled-links.test.mjs`.

## Verification on an authorized checkout

```powershell
npm.cmd test
npm.cmd run build:ui
npm.cmd run verify:css
```

After building Tauri, visually verify on Windows 11 that the full light/dark layout and chart sizing are correct with no WebView2 console error for local CSS. This check does **not** prove actual CSS loading, CSP enforcement, visual correctness, or native packaging; those remain manual Windows gates.

No production data, astronomical engines, accounts, network permission, original artwork, new dependency, release settings, repository visibility, licensing or GitHub Actions change is included. This change belongs to an independent draft PR against `main`; reconcile any overlapping CSS fixes in draft PR #18 before a main merge.
