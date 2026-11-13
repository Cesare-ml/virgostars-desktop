# Remember the last inspector tab (local, non-sensitive UI only)

**Status:** Prototype on a draft branch, stacked on keyboard-navigation PR #146. No production release, native Windows verification or full Angular build has been performed for this change.

## Behavior

Selecting **Planets**, **Houses** or **Settings** remembers just that inspector navigation tab on this device. When the application restarts on the same WebView origin, the inspector opens its last selected section. Keyboard navigation from PR #146 uses `setInspectorTab`, so both mouse and keyboard changes persist.

The independent key `virgostars.desktop.inspector-tab.v1` stores exactly one of the literal strings `planets`, `houses`, `settings`. No chart mode, birth data, subject, selected city, coordinates, calculations, notes, tokens, account identifiers or other settings are stored. This is intentionally separate from the existing versioned theme/language record; the v1 schema of `ui-preferences.ts` is unchanged.

Missing, denied, invalid or corrupted WebView storage falls back to **Planets**. Failed writes never interrupt navigation. Closing the inspector does not reset its last selected tab. Reset just this one key to reset this preference; clearing browser storage also loses it. Browser preview and Tauri may use different origins and therefore distinct local values.

## Verification and remaining gates

Actually executed in an isolated local source copy on Node.js 22.16.0, TypeScript 5.8.3:
- `node --experimental-strip-types --test tests/inspector-tab-preference.test.mjs` — **6/6 pass**.
- `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/inspector-tab-preference.ts` — **pass**.

**Not run:** full repository `npm test`, Angular `build:ui`, Windows WebView2 persistence and keyboard smoke, real Tauri build. Those gates remain mandatory before merge/release. No npm dependencies, native permissions, remote services, GitHub Actions, personal data, assets or license/NOTICE edits.

## Focus restoration when hiding the inspector

The inspector's close button lives inside the conditional `*ngIf` view. Hiding that view while a tab, row or close button has focus could discard the active focus target. The shared `toggleInspector()` now checks the focused element before collapsing: if it is inside the inspector, focus moves to the persistent header inspector-toggle using `{preventScroll: true}`. If focus is outside, it is left untouched. Failed DOM focus does not block closing. This enhancement works with the roving tab keyboard navigation in PR #146.

In an isolated local source copy, `node --experimental-strip-types --test tests/inspector-focus.test.mjs` passed **6/6** tests on Node 22.16.0. The TypeScript 5.8.3 strict DOM check for `src/app/inspector-focus.ts` also passed. This does not replace Angular compilation, real WebView2 keyboard focus testing or assistive technology verification, which remain pending.
