# Windows runtime layout diagnostic — synthetic Desktop

**Status:** implementation on a draft branch; real Windows/WebView2 visual acceptance still required.

## Why this is different from the bundle CSS gates

The existing Angular bundle verifiers can prove that approved CSS was compiled and
referenced, but not that Windows WebView2 actually applied that CSS at runtime.
VirgoStars Desktop now has a **read-only computed-style check** in the Angular shell.
It compares the computed `display: grid` on the desktop shell, workspace and
chart stage, requires the component's `--vs-accent` design token, and measures
the actual bounding boxes of the shell, workspace, chart stage **and canvas**.
The probe only reports healthy when the layout boxes have usable dimensions
and the canvas is not tiny relative to the available stage.

When the UI starts, the check records one of five results:

- **Grid detected:** the expected basic shell CSS declarations are currently applied;
  this is not proof of pixel-perfect graphics, WebGL readiness, CSP correctness, or
  that every stylesheet loaded.
- **CSS grid not applied:** at least one required computed declaration is missing.
  A warning appears in the existing footer without logging styles or personal data.
- **Chart hidden by applied styles:** grid and geometry may be valid, but an
  inspected shell, workspace, stage or canvas is computed `visibility:hidden` /
  `collapse`, or has computed `opacity:0`; a canvas with `display:none`
  is also hidden. Invalid/unknown style values report unavailable, not healthy.
  This is a CSS visibility check, not proof that Three.js drew pixels.
- **Chart drawing area is too small:** the grid and token are present, but a
  necessary container is below 96 CSS pixels on one side, or the canvas is
  below 32 pixels or under 25% of the stage's shortest side. This explicitly
  covers a previously missed case: a zero-sized stage despite active CSS.
- **Check unavailable:** a required DOM element is absent or computed-style access
  failed. This is not treated as success.

A manual **Recheck styles / Ricontrolla stili** button lives in the inspector's
Settings/Parametri tab. This avoids retry timers, network use and background polling,
and allows checking after WebView2 finishes loading or a user changes theme/size.
The check never changes layout or calls Tauri IPC.

## Verification (source)

```powershell
node --experimental-strip-types --test tests/desktop-layout-probe.test.mjs
npm.cmd run build:ui
npm.cmd run verify:css
```

## Still needed: real Windows 11 x64 GUI test

Launch the **newly built** executable after disconnecting from the Internet and
stopping the development server. Inspect the status in Settings and footer.
Test light/dark themes, a narrow window, a maximized window and Windows DPI
scaling. Confirm the actual panels, chart and typography visually. Do not relax
Tauri CSP or enable remote CSS as a workaround. If the diagnostic shows missing,
inspect the WebView2 console and the exact bundled stylesheet/Angular chunk.
If it shows detected, visual comparison is still mandatory.

The UI uses synthetic chart data only. No real astrology is activated, no
credentials, private assets, server access, new native permissions or publication
are involved. No GitHub Actions or automatic release is introduced.

## Additional geometry hardening (14 November 2026)

`probeDesktopLayout` now accepts a fourth element (`canvas`) and an injectable
bounding-rectangle reader. All measured dimensions must be finite and
nonnegative; a broken or inaccessible geometry measurement reports
**unavailable**, never a false healthy state. The probe is read-only and never
logs any element contents or personal data. It works in a normal browser
preview as well as in WebView2.

The code uses `getBoundingClientRect()`, which reports layout boxes, **not**
the Three.js/WebGL backing-buffer resolution or GPU memory. A healthy
classification is therefore only a preliminary smoke signal; it cannot prove
pixel-perfect styling, visible WebGL content or correct device-pixel-ratio
handling. During initial layout or unusual window resizing, a temporarily
small box can yield a conservative warning. Use **Recheck styles** after
maximizing/resizing to distinguish transient geometry from persistent failure.
No polling, forced resize or change to renderer internals is introduced.

Verification actually completed for this extension:
- **20/20** pure-JavaScript scenarios passed in a standalone V8 harness using
  the exact updated GitHub TypeScript helper with type annotations removed.
  Cases covered healthy/compact layouts, missing styles/nodes, thrown access,
  invalid measurements, collapsed stage/workspace and tiny canvas.
- The rewritten `tests/desktop-layout-probe.test.mjs` contains **9** Node test
  groups for the current behavior; the full Node test runner, Angular build
  and actual Windows WebView2 run have **not** been performed here.
- Source wiring and translations were verified by reading the updated branch.

On a Windows checkout, run:

```powershell
node --experimental-strip-types --test tests/desktop-layout-probe.test.mjs
npm.cmd test
npm.cmd run build:ui
npm.cmd run verify:css
```

Then open the **freshly rebuilt** native executable with the development
server stopped. Record the diagnostic at normal, maximized and DPI-scaled
window sizes, and visually confirm the real chart fills the stage. Do not
weaken CSP, add remote CSS, treat the diagnostic as native acceptance, or
ship an installer based on this source-only verification.

## Resize-aware status refresh (14 November 2026)

The same existing chart-stage `ResizeObserver` now refreshes the read-only
layout diagnostic after its size calculation, including when the stage shrinks
below the minimum chart diameter or when the computed canvas CSS size stays
unchanged. Previously the footer/Settings result could remain **active** after
a collapse until a manual recheck. The handler does not create a second
observer, schedule polling, request a remote resource or dispatch a synthetic
window resize unless the canvas CSS dimensions actually change. A queued resize
callback after Angular view destruction exits without touching the canvas.

The deferred initial check remains necessary for Angular's first view pass.
The manual recheck is still available for CSS/theme changes that do not trigger
the observed stage's geometry. This does not establish WebView2 acceptance:
run the Node probe tests, Angular build and actual Windows 11 x64 UI smoke
before merging. No complete native build was performed for this source change.

## Runtime visibility regression (14 November 2026)

The read-only probe now samples `getComputedStyle` for the canvas as well as
its three enclosing layout nodes. It detects invisible but nonzero-sized
surfaces separately from grid-missing and physically collapsed containers.
`visibility` must be one of the browser-computed values `visible`,
`hidden`, `collapse`; `opacity` must be a finite numeric value in [0,1].
Unknown values fail closed as `unavailable`. Partial opacity remains visible.
This does **not** inspect frame-buffer pixels or establish WebGL rendering:
a fully transparent/dark drawn scene may still require manual Windows QA.

Run `node --experimental-strip-types --test tests/desktop-layout-probe.test.mjs`
in a complete checkout, then `npm test`, `npm run build:ui`, and a real
Windows 11 x64 WebView2 native smoke. No new network or native access is added.

## Evidence for hidden-style regression (14 November 2026)

After updating the synthetic computed-style fixtures for replacement canvases,
**12/12** authored test callback groups passed when executed against exact
GitHub branch source in a V8 harness (using a type-stripped copy of the
TypeScript probe and in-memory file/assertion adapters). This includes
`visibility:hidden` / `collapse`, `opacity:0`, `display:none`, invalid
computed values, realistic compact viewports, and current Angular/IT-EN wiring.
The first isolated run caught two outdated canvas mock fixtures; both were
fixed and all groups were re-executed successfully.

This is **not** a complete checkout `node --test` execution, TypeScript/Angular
compilation, or a Windows/WebView2 visual test. Do not remove those gates.

## Canvas backing-buffer sanity gate (14 November 2026)

The same read-only layout probe now checks the **actual HTML canvas drawing
buffer** (`canvas.width` / `canvas.height`) alongside computed CSS and
on-screen geometry. A zero or sub-32-pixel dimension reports **collapsed**,
because a large styled canvas with zero/one native pixels cannot display the
intended readable wheel. Missing, fractional, negative or non-finite backing
dimensions report **unavailable** rather than healthy. A positive result only
means the buffer meets a minimal threshold; it does not inspect WebGL pixels,
Three.js context availability, the correct DPI ratio or rendered astrology.

Synthetic tests use in-memory canvas stand-ins with CSS box and backing
dimensions independently controllable. A real Windows/WebView2 build remains
required to prove that the upstream renderer actually creates an appropriately
sized drawing buffer after startup, resize, theme changes and zoom.

## Verification evidence for backing-buffer gate (14 November 2026)

- **Node 22.16.0, actually executed:** nine standalone synthetic Node `--test`
  smoke cases against a local, exact-byte copy of
  `src/app/desktop-layout-probe.ts`: **9 passed / 0 failed**.
  The copied source has Git blob SHA
  `6058c8026ec67a76b511ead499e920451b56c4fc`, identical to the
  committed branch file. Scenarios include healthy canvas, zero/tiny
  backing, invalid buffer, high-DPI buffer, visibility, collapsed stage
  and safely handled CSS read failure. The standalone test harness itself
  was local and was **not** committed.
- **TypeScript strict compile, actually executed:** `tsc --noEmit --strict
  --target ES2022 --lib ES2022,DOM` against that exact-byte helper:
  **passed** without Angular or external dependencies.
- **Current committed test source:** executed **14/14** test callback groups
  in a separate V8 harness using the GitHub test file, a type-stripped
  version of that same helper, and in-memory test/assertion/source
  adapters. This is **not** execution under Node's test runner.
- **Still unverified:** full committed `node --test`, `npm test`,
  Angular/Charts build, Rust/Tauri binary, Windows/WebView2 visuals
  and actual GPU buffer/render output. A nonzero canvas buffer alone
  never proves that Three.js drew the chart.

## Stage-resize fallback dependency (14 November 2026)

Desktop runtime layout diagnostic refreshes after stage geometry measurements.
The accompanying `watchChartStageResize` helper now attempts the normal
`ResizeObserver` but falls back to a window-resize listener if WebView2
cannot construct/attach an observer. Sidebar and inspector toggles request
one coalesced two-frame measurement, so the fallback still checks layout
when an internal panel changes size. Teardown invalidates queued callbacks.
This section supersedes older references to a direct `new ResizeObserver`
in the Desktop Angular component. See `STAGE_RESIZE_FALLBACK.md`.

Source-level tests and static integration checks are not a substitute for
Windows WebView2 startup, offline, high-DPI and panel-toggle acceptance.
