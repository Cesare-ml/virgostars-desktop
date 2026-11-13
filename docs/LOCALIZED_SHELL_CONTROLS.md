# Localized shell control labels

Status: **Prototype / source-level and isolated Node validation**. Native Windows/WebView2 is not verified.

## UX regression addressed

The desktop inspector was showing the current theme as the literal English strings `Light` and `Dark` even when Italian was selected. The language toggle announced the generic word “Language” rather than the **destination** of the action.

The shell now renders **Chiaro/Scuro** in Italian and **Light/Dark** in English for the *currently active theme*. Existing theme-switch action tooltips remain separate and directional (e.g. “Switch to dark mode”). The language button retains its visible `IT`/`EN` abbreviation, while its accessible label and tooltip describe the language it will switch **to**. The UI continues to use the existing in-memory locale and theme state; this PR does not add persistence.

## Change boundary

- `src/app/translations.ts`: four new symmetric IT/EN keys for current-theme state and language destinations.
- `src/app/desktop-app.component.ts`: derived getters use the active state and current locale to choose translation keys.
- `src/app/desktop-app.component.html`: language button exposes the same actionable label through `aria-label` and `title`.
- `tests/localized-shell-controls.test.mjs`: dictionary parity, wording and source wiring checks.

No change to chart computations, synthetic fixtures, storage, login, API, encryption, Rust IPC, offline city catalogue, data assets, third-party licenses, update signing or cloud operations.

## Validation to run

```sh
node --experimental-strip-types --test tests/localized-shell-controls.test.mjs
npm test
npm run build:ui
```

The narrow isolated Node/source checks may be executed without the sibling Charts build; full npm and Angular builds need the authorized complete checkout. On Windows 11 WebView2, verify both controls under light/dark mode and language switching, including keyboard focus and screen-reader announcements.

## Integration

This branch is based on `main`. The translation dictionary, shell component and template are also touched by other draft PRs (notably guest preference, offline clock, natal and CSV slices). Reconcile these small changes during integration; do not overwrite the other work. Remain in draft until normal review and native acceptance. No main merge, GitHub Actions or release.
