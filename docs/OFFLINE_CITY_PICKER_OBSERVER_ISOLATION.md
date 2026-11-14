# Offline city-picker observer isolation

**Status:** Locally tested TypeScript state-machine hardening; no native Windows/WebView2 acceptance.

## Failure model

The offline city-picker state machine accepts a `changed` observer from Angular. Previously every transition called that observer directly. An exception from `markForCheck()` or a custom observer could escape an input, move, restore, dismiss or choose event handler, or reject the asynchronous `perform()` task before its lookup ran. This could leave `loading` visible indefinitely, prevent `locationSelected` from being emitted after a successful `choose()`, or generate an unhandled promise rejection during component teardown.

All seven existing change-notification sites now use a single best-effort `notifyChanged()` wrapper. The wrapper catches exceptions **without exposing their messages**. State mutations and the existing generation/disposal protections remain unchanged, including the reentrant guard after notifying `loading`.

This is not an attempt to repair a broken Angular view; a failed observer may mean the visible UI cannot refresh until Angular recovers. The improvement is that a failed notification cannot itself abort the local search/selection state machine. It does not change the debounce delay, search text, result limit, provider contract, or owned database resource.

## Verification performed

An isolated local copy of the **exact committed state-machine source** (Git blob SHA `2831924ac1bfb4790b16f86feef91a52e055fcb8`) and the new test file was checked with Node.js 22.16.0:

```sh
node --experimental-strip-types --test tests/offline-city-picker-observer-isolation.test.mjs
tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/offline-city-picker-state.ts
```

**5/5 new tests passed; TypeScript 5.8.3 standalone strict compilation passed.** The isolated TypeScript compilation used only a local matching structural type stub for the `OfflinePlaceV1` and `PlaceQueryState` imports; this is **not** evidence that the complete Angular application compiles. Existing repository tests, full `npm test`, `npm run build:ui`, Cargo/Tauri builds and Windows WebView2 manual checks were **not run**.

## Review and Windows follow-up

Run the existing `tests/offline-city-picker-state.test.mjs` and the new test together, then `npm test` and `npm run build:ui`. On Windows, exercise city entry, keyboard selection, Escape, inspector close/reopen and rapid typing against an authorized offline catalog. Confirm no unhandled promise rejection while tearing down a view, and verify normal change detection still updates labels and results. Reconcile against open picker/IME/a11y integration PRs before merging.

No production services, personal birth records, city catalog content, data exports, account/cloud sync, astronomical calculation, Rust/SQLite, native IPC permission changes, new dependencies, GitHub Actions, licensing, publication, installer, release or main merge.
