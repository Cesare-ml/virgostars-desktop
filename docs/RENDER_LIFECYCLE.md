# Renderer lifecycle — latest request wins

Visible outer planets and Chiron participate in aspects by default. Existing
version-1 preferences with the original four disabled defaults are upgraded
once; mixed selections and later explicit choices are preserved. True node and
osculating Black Moon are included when shown and enabled. The dedicated
aspect matrix includes outer planets by default and can still hide them.

## Synastry interaction (local integration)

The desktop opts into separate dotted axes for the partner chart and omits its
duplicate axis glyphs. Hovering either chart selects its already calculated
cross-aspects; the renderer only draws the supplied facts. Deflective synastry
does not display cross-aspects. A close control returns to the single chart,
or to the original radix when closing a solar return. Browser verification
uses fictional chart fixtures; this is not a native WebView2 acceptance test.

## Chart skins (local integration, 2026-11-18)

The settings drawer selects one of the eight skins in the sibling Charts
checkout. A fresh desktop profile selects `virgostars`; the selection is a
separate device-only preference from the interface's light/dark theme. The chart
stage uses the selected skin's renderer background color to avoid a visible canvas
rectangle. Changing
the skin redraws the chart through the existing generation guard, and is blocked
during PNG export. The latitude renderer still receives the interface light/dark
asset variant via `temaGrafico`. The Charts package is built from the sibling
checkout; this is not a published package or a released desktop build. Synthetic
and owner-approved private artwork remain governed by the existing asset pipeline.

The optional Monomeri control subscribes to natal-point hover only while active.
It hides the natal aspect lines as soon as it is activated and retains the last point after
the pointer leaves; moving to a different point changes the selection. Aspects
return when the control is disabled. After a redraw, the selected point is resolved
against the current chart and house system, or cleared if absent, so a previous
degree is never carried over to another chart. It reads the true input longitude,
not the adjusted glyph position. The corpus is
private-build-only; see [the asset pipeline](ASSET_PIPELINE.md). PNG export remains
independent of hover state. Chromium picking was tested with synthetic chart data;
the desktop WebView2 interaction still needs a native GUI check.

Monomeri also accepts any rendered celestial point and the four external axis
markers; it does not generate uncalculated lots or other positions. Its center
overlay is transparent. Desktop opts into suppressing duplicate primary-axis
glyphs when the corresponding outer marker is enabled. Planet, point and sign
glyphs throughout the desktop use the approved `astrological-assets` pack.

The small getting-started guide appears until dismissed on a device and can be
reopened from Settings. The versioned preference stores only its completion flag;
it makes no account or network request. The guide is a non-modal region with
navigation, skip and close controls. Monomeri also shows a contextual prompt
until a point is selected.

Future guide design (not yet implemented): once the interface is more settled,
dim the rest of the workspace and highlight the specific control or area for each
step, while maintaining readable instructions and accessible navigation.

**Status:** narrow Angular-side async state protection implemented and unit-tested with Node 22.16.0 and TypeScript 5.8.3. **No Angular production build or WebView2 rendering test has been executed here.**

## Problem discovered

The upstream `GraficoRenderService` already serializes scene construction and uses a generation counter to reject obsolete WebGL scenes. However, the desktop **component** also holds its own `busy`, `ready`, `status`, and error flags.

A user can toggle light/dark mode while an earlier `disegnaScena()` is still awaiting scene textures. Previously, the first promise could then clear `busy`, show `ready`, or show an obsolete failure while the newer request was still in flight. This is independent of the upstream renderer correctly rejecting stale scenes.

## Solution

`src/app/render-generation.ts` provides a tiny pure TypeScript generation guard:

- A new `draw()` gets a generation ticket.
- The component captures chart arguments and skin/options before awaiting the asynchronous renderer.
- Only the latest valid ticket may set `ready`, `status`, `error`, or clear `busy` in the completion path.
- `ngOnDestroy()` invalidates all pending tickets before disposing of the renderer.
- PNG export is separately gated with `exporting` to prevent changing the chart skin while its off-screen export is in progress.
- There is no new astronomy calculation, network call, privileged IPC, private artwork, or local persistence.

This does **not** cancel in-flight asynchronous work. Upstream rendering remains responsible for canceling/discarding obsolete scenes and cleaning WebGL resources; the guard prevents stale *Angular UI state updates*.

## Validation

- `node --experimental-strip-types --test tests/render-generation.test.mjs`: **7/7 pass** in a local test copy; exact generated Git blob SHA matches the committed test and helper source.
- `tsc --noEmit --strict --target ES2022 --module ES2022 --moduleResolution bundler src/app/render-generation.ts`: **pass** with TypeScript 5.8.3.
- These tests cover out-of-order success/failure, invalid tickets, destruction and a fresh-component lifecycle. They do **not** prove that Angular templates, the npm package or the native binary compile.
- On this branch, `src/app/desktop-app.component.ts` also changes; the separate draft UI/accessibility PR #7 modifies that component, so review and reconcile both before merging.

## Windows acceptance (pending)

1. Install the authorized sibling `astrological-charts` package and run the Windows build gate in `docs/WINDOWS_BUILD_GATE.md`.
2. Run `npm test` and `npm run build:ui`; confirm Angular strict template/type checking.
3. Inside WebView2, rapidly toggle themes while loading; confirm no premature ready state or outdated errors.
4. Try resizing/collapsing panels while the scene loads; confirm full chart remains centered.
5. Export PNG and attempt theme changes while exporting; confirm the completed PNG matches the initiated mode/skin.
6. Close/reopen a window during texture loading and check for console exceptions, leaked WebGL contexts or stale callbacks.
7. Reconcile accessibility/UI PR #7 before merging.

No installer, deployment, migration, online account or public release is part of this increment. License remains undecided and GitHub Actions remain disabled.

## Transit interaction (desktop prototype)

The transit inspector navigates an independent calculated sky snapshot; its natal chart remains fixed. Cross-aspect selection is directional from transit to radix and uses desktop-computed aspect facts and current orb settings. The Charts renderer owns pointer picking and renders only those supplied facts, restoring its resources when a scene changes. Natal lines are temporarily grey and translucent in transit mode. The first-use hint stores only a device-local dismissal flag.

The desktop opts into dashed ASC, DS, MC and IC markers for the displayed transit chart, using its selected house system. They participate in transit hover and are omitted when those source axes are unavailable. The synod body selector uses the approved `astrological-assets` glyphs, with textual fallback for missing artwork or unknown bodies.

The synod panel queries the pinned experimental VirgoStars Event Ephemeris Rust reader offline. It displays the latest **recorded** event for each body and a phase only when the reader derives one from recorded thresholds. A calculated chart for the selected recorded instant is shown around the radix, alone or alongside transits; the transit clock can also be moved to that instant. The source snapshot is historical; its hash and all blocks are checked, but this does not establish complete scientific coverage.

For local development, `npm run events:prepare:local` assembles the owner's snapshot from the sibling Event Ephemeris repository into the ignored `.local/event-ephemeris` folder and checks its independently recorded SHA-256. Debug builds discover that staged file automatically. Alternatively, the native host reads `VIRGOSTARS_EVENTS_PATH` and `VIRGOSTARS_EVENTS_SHA256` together; the WebView cannot supply either. No event data are bundled or downloaded by this integration. A release needs an independently approved archive distribution and coverage review.
