# Device-only guest UI preferences (v1)

**Status: Prototype — implemented in Angular source, not yet Windows/WebView2 verified.**

The light/dark toggle and IT/EN language toggle now use a small, versioned WebView-origin `localStorage` value. They are restored before the first chart render; the document language is also updated on startup. No VirgoStars account, Internet access, native IPC or backend endpoint is involved.

## Scope and privacy

- Key: `virgostars.desktop.ui-preferences.v1`; stored JSON contains **only** `version:1`, `theme:'light'|'dark'`, and `locale:'it'|'en'`.
- Do **not** store natal records, precise locations, selected city, chart settings, notes, user IDs, device IDs, access tokens, refresh tokens or other credentials here. Future personal data must use the reviewed encrypted native repository and secure OS storage.
- Preferences are **per WebView origin/device**, not synchronized or shared with a VirgoStars account; reinstall, cache clearing or an origin change may reset them.
- When storage is missing, blocked, corrupted or contains an unknown schema version, the UI defaults to light/Italian and remains usable; writes are best-effort, not a user-data durability guarantee.
- Removing just this key resets the preferences. Do not clear all application storage to reset them.

## Implementation

`src/app/ui-preferences.ts` owns strict parsing, length bound, key and allowlisted serialization. `DesktopAppComponent` reads the initial preferences once, persists only when a toggle is used and sets `document.documentElement.lang` on startup and language changes. Chart rendering remains owned by the existing library and follows the initial theme; this patch neither creates astronomical calculations nor changes the existing redraw policy.

## Verification

Run `npm test` (includes `tests/ui-preferences.test.mjs`) and `npm run build:ui` after installing the approved upstream Charts package. The isolated six Node tests and standalone TypeScript strict check passed in the authoring environment with Node 22.16.0; **the complete Angular build and native WebView2 restart persistence have not been run here**.

On Windows, toggle dark and English, fully close/reopen the native app, verify the initial selected appearance and English labels, and repeat with local storage disabled (the application should remain usable with session-only choices). Test the browser preview separately because its origin may have a separate preference store.

## Integration constraints

UI PR #7 also edits the shell, and PR #23 adds an AI inspector. Resolve any shared file conflicts when integrating; do not merge this draft automatically. No GitHub Actions, cloud sync, release, account migration or license selection are part of this patch.
