# Localized active-theme label

**Status:** Small proposed Desktop UI fix. The inspector's Settings tab previously rendered the English words `Light` / `Dark` even when the device's selected interface language was Italian.

The active theme now uses the same `translate(locale, key)` mechanism as the rest of the Angular shell:

| Locale | Light selected | Dark selected |
| --- | --- | --- |
| Italian | Chiaro | Scuro |
| English | Light | Dark |

The toggle control keeps the separate imperative labels (e.g. **Attiva tema scuro** for a currently light theme); no storage schema, preference keys, theme behavior, color tokens or renderer logic changes. This is purely a displayed state label, not a promise of completed desktop UI acceptance.

## Checks

```sh
node --experimental-strip-types --test tests/desktop-theme-i18n.test.mjs
npm test
npm run build:ui
```

Reviewers should switch IT/EN and light/dark in a real Windows WebView2 session while the inspector is on **Parametri**, and verify both the current value and the button's accessible action label. Until that smoke test and the actual Angular build run, this remains a prototype source change. No source publication or installer approval is implied.
