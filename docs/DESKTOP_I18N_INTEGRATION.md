# Desktop i18n integration: errors, active theme and language-switch action

Status: **Prototype / reviewable stacked draft**. This branch combines complementary changes without publishing or merging the desktop app.

## Why integrate

Two active drafts change overlapping Angular shell and translation files:

- **#90** fixes renderer alerts becoming stale after IT/EN language switching and translates the **current** light/dark theme in Settings.
- **#92** localizes the language button's **destination** for assistive technology and adds an accessible tooltip; it also independently translated the current theme.

To avoid implementing competing theme-label systems, this integration **starts from #90**, keeps its original `displayThemeLabel` and `displayMessage` code, and adds **only the unique language-switch action improvement** from #92. No theme-label keys from #92 are duplicated.

## Contract

- Keep renderer errors as `MessageKey | null` in component state; resolve them using the current locale on every view update. Never render thrown error paths/messages directly.
- Theme Settings displays the **active** theme; its switch button describes the **opposite action**.
- `displayLanguageAction('it')` returns `Passa all'inglese`; `displayLanguageAction('en')` returns `Switch to Italian`. The language switch control binds both its `aria-label` and `title` to the derived action.
- The visible abbreviation continues to show the **current** language (`IT` or `EN`); the accessible label describes the **destination**.
- All work stays in memory. No authentication, sync, user birth records, persistent preferences, astronomical calculation, external access, privileged native command or asset changes.

## Verification

Run on an authorized complete checkout with Node 22 LTS:

```sh
node --experimental-strip-types --test tests/desktop-i18n-state.test.mjs tests/desktop-i18n-integration.test.mjs
npm test
npm run build:ui
```

The new regression suite checks dictionary key parity, both destination-language labels, current-theme labels, live retranslation of a renderer-error key and Angular component/template source bindings.

**Validation actually performed in this development pass:** the exact **nine test bodies** from the committed parent suite (3) and integration suite (6) ran against the committed translation/helper source in an isolated V8 harness: **9/9 PASS**. The harness removed TypeScript-only syntax, provided narrow assert/test and file-read shims, and supplied the actual committed Angular component/template strings for source assertions. GitHub source blob identities were verified for all five files. **This is not execution of the committed Node test files with Node's own test runner, nor a complete checkout**; the full \`npm test\`, Angular strict build and native Windows 11 Tauri/WebView2/screen-reader acceptance remain pending.

## Review and merge ordering

- Parent draft: **#90**, branch `fix/i18n-theme-error-20261113`.
- Complementary overlapping draft: **#92**, branch `fix/localized-shell-toggle-labels-20261113`.
- This integration PR targets the parent #90 branch, **not** `main`. Review the integration first and then decide whether to use its combined head as the single eventual merge candidate. Do **not** merge both independent feature PRs *and* this integration PR as separate copies of the theme changes.
- Re-fetch parent and main before any later merge; multiple workers may alter the same UI files. Run the full test/build/Windows gate and obtain maintainer approval.

No license/visibility change, automatic GitHub Actions, production release, cloud backend or main merge.
