# Renderer lifecycle — latest request wins

## Chart skins (local integration, 2026-11-18)

The settings drawer selects one of the eight skins in the sibling Charts
checkout. A fresh desktop profile selects `virgostars`; the selection is a
separate device-only preference from the interface's light/dark theme. Changing
the skin redraws the chart through the existing generation guard, and is blocked
during PNG export. The latitude renderer still receives the interface light/dark
asset variant via `temaGrafico`. The Charts package is built from the sibling
checkout; this is not a published package or a released desktop build. Synthetic
and owner-approved private artwork remain governed by the existing asset pipeline.

The optional Monomeri control subscribes to natal-planet hover only while active.
It temporarily hides the natal aspect lines, restores them on leave or deactivation,
and reads the true input longitude, not the adjusted glyph position. The corpus is
private-build-only; see [the asset pipeline](ASSET_PIPELINE.md). PNG export remains
independent of hover state. Chromium picking was tested with synthetic chart data;
the desktop WebView2 interaction still needs a native GUI check.

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
