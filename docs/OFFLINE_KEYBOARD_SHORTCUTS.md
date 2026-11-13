# Offline chart keyboard shortcuts

**Status:** synthetic-only Angular prototype; native Windows/WebView2 acceptance pending.

## User-facing behavior

In VirgoStars Desktop, use these optional keyboard shortcuts while the workspace (rather than a text field or interactive accessibility widget) has focus:

| Shortcut | Action |
| --- | --- |
| Alt+Shift+1 | Natal demonstration chart |
| Alt+Shift+2 | Transits demonstration chart |
| Alt+Shift+3 | Synastry demonstration chart |
| Alt+Shift+4 | Latitudes demonstration chart |
| Alt+Shift+0 | Fit the currently ready chart |

The same commands remain available through visible navigation and toolbar buttons. The Settings inspector provides the shortcut legend in English and Italian. Keys are identified by physical `KeyboardEvent.code` (Digit1–4 and Digit0), not locale-sensitive characters, to avoid ambiguity across keyboard layouts.

## Safety and lifecycle

`src/app/desktop-shortcuts.ts` is a pure, tested intent parser. It does not create a renderer, alter birth data, perform calculations, save preferences or call Tauri IPC. It accepts only Alt+Shift without Ctrl/Meta; ignores repeated/composing/already-handled events; and does not intercept keyboard input inside INPUT, SELECT, TEXTAREA, contenteditable parents or editable nodes surfaced by `composedPath()`. Composite ARIA editors (`textbox`, `searchbox`, `combobox`, `spinbutton`, sliders, grids, menus and listboxes) are excluded too, including interactive ancestors and modal/dialog focus. An ordinary `role=toolbar` does not disable shortcuts. Invalid event paths fail closed.

The Angular `HostListener` only prevents the event's default behavior **after** the action passes existing guards. Mode switching is ignored while the renderer is busy, before initialization, or when the requested mode is already selected. Fit is ignored before the chart is ready, during a redraw and while exporting. Angular destroys the registered host listener with the component; this does not add a manual window listener.

These are **synthetic demo modes**, not independently validated natal, transit or synastry calculations. No third-party keyboard shortcuts or system-global hotkeys are installed. Operating-system shortcuts and accessibility technology may intercept certain combinations before WebView2 receives them; the visible buttons are the supported fallback.

## Verification

- Tested locally on Node.js 22.16.0 with `node --experimental-strip-types --test tests/desktop-shortcuts.test.mjs`: **22/22 pass** in an isolated checkout containing byte-identical committed source and tests.
- `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/desktop-shortcuts.ts`: pass with the matching `ChartMode` declaration from `workspace-state.ts`.
- Angular component/template/i18n links are reviewed from committed GitHub source. The full repository `npm test`, Angular build against the sibling Charts package, and native Tauri Windows keyboard acceptance are not covered by these isolated tests.

### Remaining acceptance on Windows

From an authorized checkout of the complete feature branch, run `npm test`, `npm run build:ui` and the Tauri development build. Verify both languages, all five shortcuts, disabled actions during redraw/export, focus inside the offline city-search input (including IME), focus in ARIA date/time spinbuttons, combobox/listbox results and modal dialogs, plus interaction with Windows keyboard-layout switching and screen readers. Do not remove the fallback buttons if the operating system intercepts Alt+Shift.

No account, network, file I/O, persistent personal data, secrets, new npm dependencies, build/CI workflows, release, licensing, visibility or production changes. Leave this feature in a draft PR until reviewed and natively validated.
