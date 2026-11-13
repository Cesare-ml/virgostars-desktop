# Device-only guest UI preferences (v1)

**Status: Prototype — locally tested on Windows/WebView2; not released.**

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

On 2026-11-12, the code at `6de54e9e5fcca4a44d088b28775390e763c21a99` was tested in an isolated Windows snapshot with Node 22.18.0 and the locally built Charts package:

- `npm test`: **128/128 passed**, including the six preference tests, malformed data, and unavailable-storage behavior.
- Synthetic asset preparation, Angular production build, and offline bundle verification passed (392 verified synthetic assets). The build reported an existing `moment-timezone` CommonJS optimization warning.
- Tauri Windows debug build completed with synthetic assets and a separate application identifier to avoid modifying the ordinary app profile. In WebView2, English and dark mode were selected; after fully closing and reopening the executable, English and dark mode were visibly restored. This was a local smoke test, not a release or installer test.

Further verification: test storage disabled in WebView2 and browser preview separately, since their origins may have separate preference stores; test other platforms when supported. The manual smoke did not inspect `document.lang` or timing of the first painted frame.

## Integration constraints

UI PR #7 also edits the shell, and PR #23 adds an AI inspector. Resolve any shared file conflicts when integrating; do not merge this draft automatically. No GitHub Actions, cloud sync, release, account migration or license selection are part of this patch.
