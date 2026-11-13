# Device-only UI preferences: fail-closed writes

**Status:** Locally tested, synthetic-only hardening. This does not add identity, personal records, offline chart storage or synchronization.

The existing v1 browser/WebView preference key stores only the explicitly allowed `theme` (`light`/`dark`) and `locale` (`it`/`en`), with version `1`. The app defaults to Italian/light mode when storage is inaccessible or the saved content is invalid. This storage must never be used for birth details, authentication or tokens.

`saveUiPreferences` now snapshots each preference field **once** within a guarded write, validates both snapshots before saving, and serializes only the selected fields. A missing/malformed caller, throwing property getter or inaccessible WebView storage returns `false` without propagating an exception or saving partial state. User-visible preferences remain unchanged on a failed write; callers may continue rendering their in-memory choices.

## Regression check

```sh
node --experimental-strip-types --test tests/ui-preferences-hardening.test.mjs
```

The four synthetic tests exercise one-read snapshotting, hostile accessors, missing/invalid input, and storage accessor failures. They do not verify Windows WebView2 persistence, user data encryption, or app-wide Angular behavior. Run the repository-wide `npm test` and a native smoke test before integrating into a release candidate.

No changes to native IPC, Tauri permissions, cloud endpoints, third-party assets, dependencies, CPAL attribution or production settings.
