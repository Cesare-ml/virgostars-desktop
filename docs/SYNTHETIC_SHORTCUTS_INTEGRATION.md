# Integrating chart keyboard shortcuts with the fictional desktop inspector

**Status: Prototype / integration draft. Native Windows and full Angular builds are unverified.**

## Parentage and intent

This feature is **stacked on draft PR #99** (`integrate/synthetic-longitude-display-rebased-20261113`), which already includes the coherent chart/inspector/CSV geometry from #93, #87 and #82, plus circular/IT–EN degree rendering from #83. It incorporates the **existing reviewed implementation** from **PR #98**, rather than inventing a second shortcut parser.

This combined branch retains the exact #98 Git blobs for `src/app/desktop-shortcuts.ts`, `tests/desktop-shortcuts.test.mjs`, `tests/desktop-shortcuts-integration.test.mjs`, and `docs/OFFLINE_KEYBOARD_SHORTCUTS.md`. The Angular component, template and existing IT/EN dictionaries have been edited narrowly on the #99 parent version so the later inspector formatting and CSV download integration are preserved.

## User behavior

| Keyboard shortcut | Local synthetic action |
| --- | --- |
| Alt+Shift+1 | Natal demo chart |
| Alt+Shift+2 | Transits demo chart |
| Alt+Shift+3 | Synastry demo chart |
| Alt+Shift+4 | Latitude demo chart |
| Alt+Shift+0 | Fit current ready chart |

These **optional local** shortcuts only invoke the existing guarded `setMode` and `fitChart` methods. The keyboard parser never owns exports, native calls, astronomy, storage, network or accounts. It ignores repeated/already-handled/composing keyboard events, requires exactly Alt+Shift, and excludes native inputs, contenteditable elements, ARIA composite editors, dialogs, modal ancestors and potentially untrusted composed event paths.

The application does not prevent default keyboard behavior until a supported action can really execute; busy, uninitialized, destroyed or exporting states block commands, and fit requires a ready chart. Existing onscreen controls remain available, especially if Windows uses Alt+Shift for switching keyboard layouts.

The Settings inspector lists the shortcuts in both languages. The planet and house inspector still formats longitude decimals as **IT `19,3°` / EN `19.3°`**, and the 22 fictional CSV records always use a decimal point and the `FICTIONAL_NOT_CALCULATED` provenance.

## Tests and review evidence (2026-11-13)

- **22/22 upstream shortcut parser test bodies passed** in an isolated V8 harness running the exact committed implementation with its TypeScript-only declarations removed. This is not the Node.js test runner or a full-checkout Angular test.
- **16/16 direct source readback checks passed** against the integrated GitHub branch for `HostListener`, guarded actions, locale formatting, CSV port, translations, input/IME protections and both inspector lists.
- A dedicated `tests/synthetic-shortcuts-integration.test.mjs` adds five test cases: allowed actions only, city input focus protection, 22-position CSV stability under locale and keyboard actions, Angular guard/source wiring and bilingual template labels. These five committed test cases **have not yet been executed in the full checkout**.
- The four original #98 source-level integration tests are present and unchanged. Their full Node execution is also a pending gate.

## Run before any merge

```sh
npm test
npm run build:ui
npm run doctor
```

On an authorized Windows 11 Tauri/WebView2 build, smoke-test all five hotkeys, keyboard focus in the offline city picker, ARIA editors, modal content, IME composition, switching IT/EN and switching visual chart mode while requests are pending. Re-test synthetic CSV download, localization and WebGL chart fit. The runtime's actual astronomical calculations are still **not connected** through these shortcuts, and no production-ready accuracy is claimed.

**No merge to main**, GitHub Actions, deployment, new dependencies, app-store release, network integration, account/data changes, licensed artwork change, repository visibility or license modification. Review #98 and this stacked integration PR as **alternatives for the same hotkey changes**, not as independent duplicate commits.
