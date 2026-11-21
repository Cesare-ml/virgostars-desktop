# Experiment: Codex-style native window (Windows)

Branch: `experiment/codex-style-window`. **Not part of main or any public release.**

## Scope

- Windows: native frame replaced by a 42px custom Angular titlebar, keyboard-accessible minimize/maximize/close buttons, drag region, double-click maximize, and eight native resize hit targets. Tauri 2 Windows-only config enables a transparent WebView with the system Mica backdrop.
- The existing sidebar remains dark for glyph contrast; the titlebar and right panel have a restrained translucent treatment. The astrological chart and its renderer are unchanged.
- macOS/Linux: continue to use their native window decorations; no private macOS APIs, no extra dependencies or permissions.
- Browser preview: the custom chrome is not rendered; it appears only in a native Windows WebView.

## Run and inspect

1. Switch to this branch: `git switch experiment/codex-style-window`.
2. Use the existing VirgoStars Desktop development prerequisites (local sibling packages and staged assets), then run `npm run tauri:dev`. The Tauri CLI automatically merges `src-tauri/tauri.windows.conf.json` on Windows.
3. Validate with `npm test` and `node scripts/verify-tauri-security-config.mjs`. Existing Windows release scripts will pick up the platform override when building from this branch.

Check (on Windows 11): drag empty titlebar areas; double-click to maximize/restore; use the three buttons; resize from all sides/corners; check dark/light theme, initial login, fullscreen/maximized and window sizes near the minimum 850×620. Mica varies with OS version, wallpaper and accessibility settings; on Windows 10 or with transparency effects disabled the translucent UI should degrade to the CSS surface colors.

## Safety and rollback

- The baseline `src-tauri/tauri.conf.json` and CSP are unchanged. The Windows override is strictly validated by `scripts/verify-experimental-window-chrome.mjs`, called from the existing security gate.
- Native permissions are limited to the main window and the six window-control operations (close, minimize, toggle-maximize, is-maximized, start-dragging, start-resize-dragging).
- No automatic merge to `main`. To revert, switch back to `main`. If accepted later, first verify that native window resize, snapping, accessibility, Mica appearance, titlebar buttons and clean Windows/macOS builds behave correctly.

This is an experimental implementation; actual Windows 11 rendering and packaged artifact behavior require a real OS build and visual check.

## Visual iteration from the 21 November Windows screenshot

The initial Windows screenshot showed a working but visually detached light header,
a duplicate VirgoStars brand in the sidebar and a **false** `styles.collapsed`
warning obscuring the chart's MC label.

Implemented on this branch:
- Moved the existing navigation toggle into the native titlebar. The sidebar's
  duplicate brand/header is hidden *only* while custom Windows chrome is active.
  The bar's left segment matches the existing dark sidebar, including collapsed
  60px and automatic <=760px navigation rail.
- Removed the promotional centered titlebar caption and made the Mica header
  slightly softer, with themed light/dark translucent surfaces.
- Extended the read-only `probeDesktopLayout` with an *optional measured*
  `chrome` element. If it is provided, the workspace must begin immediately
  below the bar and fill the remainder of the shell; the bar must span the
  shell's full width and align at its top-left. Missing/unreadable/hidden,
  incorrectly sized or offset bars do not count as healthy.
- Without a custom `chrome` element (macOS, Linux and browser), all original
  zero-inset geometry checks remain unchanged.
- Moved any *genuine* layout warning to the chart's top-right corner so that
  it does not obscure the MC axis.
- Added regression tests for native inset geometry, false positives, mismatched
  titlebar sizes/positions, a single visible brand and toggle wiring.

These changes were applied without changing the chart renderer, ephemeris
engine, native permissions or the base Tauri config. **Source checks are not
visual Windows acceptance**: run `npm test`, `npm run build:ui:private` if
local assets are available, and `npm run tauri:dev` on Windows 11, then verify
minimize/maximize/restore/snap, resize edges, the light/dark backdrop, DPI,
narrow windows and the diagnostic's absence on a healthy chart. Do not merge
until this is checked in an actual Windows build.


## Third iteration — native-feel polish

The user requested further refinement of the Codex-like Windows experiment.
The following changes remain **isolated on this branch**:

- The middle of the top bar now shows a subdued, localized *workspace title*
  (sky, natal chart, transits, archive, settings, directions, returns, etc.).
  It intentionally **does not include any person's name** even when a private
  chart is displayed.
- The navigation toggle has an explicit `aria-controls` target and keeps its
  original `toggleNavigation()` behavior. The duplicate sidebar brand remains
  hidden only when the native Windows chrome is active.
- The Tauri-native maximize-state query now coalesces resize/focus events
  rather than discarding the final query when events overlap. It also ignores
  late responses after the Angular component is destroyed.
- The titlebar indicates focus discreetly; buttons remain keyboard-focusable,
  with dedicated focus styles.
- Chromium's `app-region:drag` supplements the original Tauri
  `data-tauri-drag-region` for **Windows pen/touch input**; interactive
  buttons are explicitly `no-drag`.
- Theme-specific Mica gradients remain subtle, while `forced-colors`,
  `prefers-contrast`, and `prefers-reduced-transparency` provide a solid
  surface for accessibility. The astrological chart itself is still opaque.
- Responsive navigation now uses the actual **workspace height** (after the
  42px custom header), avoiding unnecessary rail collapse.
- Additional source tests check focus, context labeling, accessibility,
  and responsive layout. A manual repository readback confirmed 16/16
  source invariants; **this was not an Angular, Node test-runner, or native
  Windows execution**.

### Validation checklist before any merge

Run from the branch on a real Windows 11 computer:

```powershell
git switch experiment/codex-style-window
git pull --ff-only origin experiment/codex-style-window
npm test
npm run tauri:dev
```

On the native window, inspect: all eight resize handles; double-click title
and maximize/restore; Win+Arrow snap; Alt+F4; minimize/restore via taskbar;
mouse and touch/pen dragging; title while switching views and language;
keyboard focus indicators (Tab, Shift+Tab); light/dark theme; minimized/
maximized state while switching monitors or DPI; Windows high contrast and
transparency settings. The layout diagnostic should report **active** when the
chart is correctly sized, and still flag genuinely collapsed geometry.

**Limitations:** replacing the native Windows caption controls may lose some
built-in features, such as the native Windows 11 maximize-hover Snap Layout
flyout. Windows keyboard snapping should be checked separately. Do not claim
full native caption parity without dedicated OS testing. The macOS/Linux
window configuration and `main` remain unchanged.


### Rendering-cost note

The large, full-height sidebar and inspector no longer use CSS
`backdrop-filter:blur(...)`: the Windows native Mica surface supplies the
background treatment without running two extra panel-sized backdrop passes.
Only the small 42px titlebar retains a CSS blur. This is an implementation
optimization, **not a benchmark**; measure GPU behavior in Cielo 3D on
Windows before merging.


## Fourth iteration — native window state correctness (21 November 2026)

The custom chrome now listens to `Window.onResized`,
`Window.onFocusChanged`, and `Window.onScaleChanged` (Tauri 2), in
addition to retaining WebView DOM resize/focus events as fallback. This
addresses native Windows operations that need not produce a matching
WebView event, especially taskbar restores, snap transitions, and DPI changes
when moving between monitors. Native callbacks enter Angular's `NgZone`
before updating the displayed state.

A pure `WindowChromeStateCoordinator` serializes `isMaximized()`
queries and coalesces bursts into one final refresh. It ignores late
results after disposal and tolerates transient native errors without
breaking the controls. **6/6 actual Node 22 tests passed** against this
helper, including bursts, delayed results, errors and disposal. The
helper also passed a standalone strict TypeScript 5.8.3 check.
Each Tauri event subscription is tracked independently and unsubscribed
even if another subscription fails or never resolves; late subscriptions
are immediately removed after component destruction.

The Windows-only capability is expanded by just these commands:
`core:event:allow-listen`, `core:event:allow-unlisten`, and
`core:window:allow-internal-toggle-maximize`. The last command enables
the built-in double-click on Tauri drag regions. The Angular `(dblclick)`
handlers on those same regions are removed to avoid a potential
double-toggle. All permissions remain scoped to the sole `main` window
on Windows, with exact-value validation in the experimental security gate.
Mac/Linux and baseline `tauri.conf.json` remain unchanged.

### Verification

Run `npm test`, `npm run verify:ipc`, `npm run build:ui:private`
(with private local assets staged) and `npm run tauri:dev` on Windows.
Also check Snap Assist using Win+Arrow, titlebar double-click,
un/maximize from the button, resizing after changing display scale,
restore from taskbar, and the real window focus color. Windows 11
maximize-hover Snap Layout is **not guaranteed** by this frameless
experiment.

The runtime on an actual Windows machine and the complete Angular/native
build are still pending; do not merge this branch yet.

### Native scale event → wheel backing buffer

The same Windows-only `onScaleChanged` subscription now emits an Angular
output to the workspace. It calls the existing `fitStage()` without changing
the graph geometry; if CSS dimensions do not change, it still dispatches a
single renderer `resize` event to refresh device-pixel-ratio-dependent canvas
backing pixels. If `fitStage()` already resized the canvas, it does not send a
second redundant event.

Additional source guard tests cover native event wiring and this redraw
fallback. Actual multi-monitor/high-DPI testing is still required before
a release.
