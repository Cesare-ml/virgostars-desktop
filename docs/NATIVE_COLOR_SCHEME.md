# Native color-scheme alignment — WebView2 and browsers

**Status: source-level fix with synthetic regression checks. Windows visual acceptance pending.**

## Problem

The Desktop UI already saves an explicit light/dark choice in device-only
preferences and uses `data-theme` to switch CSS colors. However, the document
root declares `color-scheme: light` and the Desktop theme selectors previously
did not override the browser's native `color-scheme` property. In a dark
workspace, the WebView can therefore render scrollbars and native form
controls with the light system palette.

## Change

- Declare `color-scheme: light` on `.desktop-app`, in addition to the
  existing light default on `:root`.
- Declare `color-scheme: dark` specifically on
  `.desktop-app[data-theme="dark"]`; children such as the scrolling inspector
  inherit the correct native widget palette.
- Continue to derive theme from the existing **user preference**, not the
  operating system's `prefers-color-scheme` media query. The setting stays
  deterministic across offline restarts and does not introduce a new storage
  field or migration.
- No JavaScript, Tauri IPC, renderer asset, remote resource, dependency, or
  cloud API changes. The global root still defaults to light before Angular
  is mounted.

## Checks

```sh
node --test tests/native-theme-color-scheme.test.mjs
npm test
npm run build:ui
```

The source-level Node tests assert explicit theme declarations and verify
that the Angular template binds `data-theme` to the saved/toggleable theme.
They **do not** prove that WebView2 applies the CSS at runtime.

## Required manual Windows 11 smoke

1. Run an authorized synthetic Angular/Tauri build with the existing Windows
   build gate and verify that the CSS bundle actually loads.
2. Inspect the Settings panel scrollbar, search field, and other native
   widgets in **light** mode. They should use light system coloration.
3. Toggle to **dark** mode: scrollbar and native widgets should follow the
   dark palette, while chart colors remain controlled by the upstream renderer.
4. Restart the native application offline: the chosen theme persists without
   network or account access. Check high contrast/forced colors separately;
   this change is **not** a Windows accessibility acceptance sign-off.
5. Confirm that the native CSS is loaded from packaged assets, not a remote
   stylesheet, and that the theme switch does not trigger external requests.

Keep the existing CSS/native layout acceptance gate open until the above
passes on real WebView2. See [Windows GUI Smoke](WINDOWS_GUI_SMOKE_2026-11-10.md).

## Impact assessment

No personal data, credentials, new permissions, astronomical calculations,
private artwork, packaging/release change, sync behavior or persistence schema
change. Existing CPAL-1.0 attribution remains unchanged. This patch may
overlap with draft accessibility/high-contrast CSS work; reconcile selectors
before merging either branch.
