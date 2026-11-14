# Windows High Contrast (forced colors) — accessibility slice

**Status: Prototype; source-level contract tests only.** No Windows contrast-theme
WebView2 visual acceptance has been performed for this change.

## Behavior

Windows Contrast themes (CSS `forced-colors: active`) override custom light/dark
color tokens with OS system colors such as `Canvas`, `CanvasText`,
`ButtonBorder`, `ButtonFace`, `Highlight`, `HighlightText` and `GrayText`.
These are browser-resolved colors, not new hard-coded RGB approximations.

- The same system palette applies whether the Desktop light or dark theme is selected.
- Selected chart navigation modes, inspector tabs and planet rows gain visible
  outlines, since translucent selected backgrounds may disappear in contrast themes.
- The offline city picker separately outlines selected search results and keyboard
  focus: Angular component-scoped CSS cannot reliably style its child from the
  parent stylesheet.
- Disabled buttons retain legible system `GrayText` rather than being faded
  to 42% opacity.
- Never set `forced-color-adjust: none` to make branding override the user's
  chosen contrast theme. The chart itself is WebGL and requires a separate
  accessibility review; synthetic renderer imagery is **not** made high-contrast
  by these CSS rules.

## Source checks

Run `node --test tests/windows-high-contrast.test.mjs` (or `npm test` in a
full checkout) to check selectors, semantic tokens and the disabled-control
override. These static contracts do not measure actual computed styles or WCAG
contrast ratios in a running Windows WebView2 host.

## Manual acceptance still required

1. On Windows 11, enable a Contrast theme in **Settings → Accessibility →
   Contrast themes**. Restart the packaged prototype if WebView2 does not
   refresh its style media query promptly.
2. Test both Desktop light and dark toggles; all key text, borders and buttons
   should continue to use the system palette.
3. Use Tab and Shift+Tab through navigation, inspector tabs, export and city
   search; focused and selected controls must be identifiable separately.
4. Verify disabled Archive/Research controls are readable and clearly disabled,
   without mistaking their appearance for enabled actions.
5. Inspect city suggestions, scrollbars, errors and the chart area with keyboard
   and screen reader; log issues without personal or real birth data.
6. Repeat with contrast themes off and verify standard light/dark appearance,
   then run the local Windows build and offline-bundle gates.

No astronomy, authentication, sync protocol, native IPC, packaged asset,
update signing, installation, production service or repository visibility
changes are part of this slice. CPAL/NOTICE attribution remains unchanged.
