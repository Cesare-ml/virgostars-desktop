# Renderer lifecycle — latest request wins

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

## Language-switch-safe display strings (2026-11-13, isolated draft)

Rendering failures are stored as a typed **message key**, not as localized Italian or English text. The error template resolves the key using the current locale on every change-detection pass; switching language after a failure must immediately update the message without re-rendering a failed chart. The current theme name in Settings also resolves from the current locale. A missing error key resolves to an empty string; no private details are rendered or logged. This does not alter scene cancellation, IPC, offline storage, chart accuracy or chart export.

A pure Node test verifies Italian/English theme labels, error re-localization and the empty-error path; a source-contract assertion guards the component/template bindings. Full Angular/WebView2 validation remains required before merge.
