# Integrating chart keyboard shortcuts with the fictional desktop inspector

**Status: Prototype / integration draft. Native Windows and full Angular builds are unverified.**

## Parentage and intent

This feature is **stacked on draft PR #99** (`integrate/synthetic-longitude-display-rebased-20261113`), which already includes the coherent chart/inspector/CSV geometry from #93, #87 and #82, plus circular/IT–EN degree rendering from #83. It incorporates the **existing reviewed implementation** from **PR #98**, rather than inventing a second shortcut parser, and now also consolidates the independent **PR #96** error/theme/language localization without losing shortcut and CSV integration.

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

The Settings inspector lists the shortcuts in both languages. Active-theme labels and the language-switch button are localized via pure translation helpers. Renderer failure UI state now retains only the typed `chart.failed` message key, which is translated at display time: changing IT ↔ EN while an error is shown updates the alert without leaking thrown error details. The planet and house inspector still formats longitude decimals as **IT `19,3°` / EN `19.3°`**, and the 22 fictional CSV records always use a decimal point and the `FICTIONAL_NOT_CALCULATED` provenance.

## Tests and review evidence (2026-11-13)

Actual isolated validation with Node.js **22.16.0** and TypeScript **5.8.3**, using locally mirrored files whose **Git blob SHA hashes exactly match the integrated GitHub branch**:

```sh
node --experimental-strip-types --test \
  --test-skip-pattern='merged component|merged Angular|integrated Angular shell|integrated template|actual desktop source' \
  tests/desktop-shortcuts.test.mjs \
  tests/synthetic-shortcuts-integration.test.mjs \
  tests/desktop-shortcuts-i18n-regression.test.mjs \
  tests/format-longitude.test.mjs \
  tests/synthetic-inspector-csv-precision.test.mjs

tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM \
  src/app/desktop-shortcuts.ts src/app/workspace-state.ts \
  src/app/fictional-geometry.ts src/app/format-longitude.ts \
  src/app/synthetic-csv-export.ts src/app/translations.ts
```

- **38/38 selected real Node tests passed, 0 failures and 0 skips.** This includes **22 upstream parser cases**, **3 executable shortcut/CSV integration cases**, **4 executable new i18n/keyboard cases**, and **9 existing geometry/longitude/CSV cases**.
- Strict standalone TypeScript compilation of **all six pure modules passed**. It is not an Angular component compilation or proof of a native build.
- Git blob SHA verified for all **six pure modules** and **five executed test files**. Relevant new blobs: `src/app/translations.ts` `486cc2346562fd4aa61f922380f5c1207d9167b1`, `tests/desktop-shortcuts-i18n-regression.test.mjs` `7a4c92ad45fb1f437e346354e1ae5d66c3cf892e`.
- **15/15 source-level GitHub readback checks** passed for current Angular shell/template, translated error/active theme/action, preserved shortcut listener, IT/EN longitudes, fictional CSV and non-networked browser export port.
- Two source-only cases in the original shortcut/CSV integration suite, two in the new i18n suite, and four original #98 source-integration cases **have not been executed against a complete checkout**. Three original source-wiring tests from #96, plus its six pure behavior tests, have not yet been rerun with the actual Node runner in the combined full checkout. The actual Node runner filters such tests here; direct source readback checks are not equivalent to Angular compilation or end-to-end behavior.

### Newly integrated i18n slice (from #96)

- `src/app/translations.ts` adds only the symmetric IT/EN keys `language.switchToEnglish`, `language.switchToItalian`, `settings.theme.light` and `settings.theme.dark`, plus pure `displayLanguageAction`, `displayThemeLabel` and `displayMessage` helpers. Existing CSV and shortcut translations remain.
- `src/app/desktop-app.component.ts` stores the error key (`MessageKey | null`) rather than a snapshot of localized failure text, and derives the localized display after language changes. Guards for rendering, keyboard shortcuts and CSV remain.
- `src/app/desktop-app.component.html` uses `errorText` for alerts and the actionable `languageToggleLabel` for `aria-label` and `title`.
- Exact original test files `tests/desktop-i18n-state.test.mjs` and `tests/desktop-i18n-integration.test.mjs` are preserved from #96. Added six-case `tests/desktop-shortcuts-i18n-regression.test.mjs` to exercise combined behavior.
- **Merge choice:** this branch is an alternative integration of #96 alongside #98/#99, not approval to merge #96 independently and duplicate the same changes.

## Run before any merge

```sh
npm test
npm run build:ui
npm run doctor
```

On an authorized Windows 11 Tauri/WebView2 build, smoke-test all five hotkeys, keyboard focus in the offline city picker, ARIA editors, modal content, IME composition, switching IT/EN and switching visual chart mode while requests are pending. Re-test synthetic CSV download, localization and WebGL chart fit. The runtime's actual astronomical calculations are still **not connected** through these shortcuts, and no production-ready accuracy is claimed.

**No merge to main**, GitHub Actions, deployment, new dependencies, app-store release, network integration, account/data changes, licensed artwork change, repository visibility or license modification. Review #98 and this stacked integration PR as **alternatives for the same hotkey changes**, not as independent duplicate commits.
