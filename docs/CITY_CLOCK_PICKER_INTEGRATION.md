# Offline city picker + local clocks integration

**Status:** experimental synthetic-only integration draft; **not merged**; native Windows/WebView2 and complete Angular validation still required.

## What this branch integrates

This branch is based on **#101** (fail-closed live device clock), which extends **#46** (device / selected-city clocks), itself based on **#45** (device-only guest UI language and theme preferences). It ports the reviewed source from **#78** (consolidated per-component offline city search, strict native reply decoding, explicit Clear location, retry and scoped cancellation) without replacing the entire desktop shell.

- Preserve the parent chart's local-device settings, bilingual clock labels, device and selected-city clocks, native runtime probe and fictional renderer.
- Bring the same city contract, state machine, component, template, styles and offline-place search adapter as the existing #78 draft, along with that branch's tests and native search docs.
- Resolve the overlapping `translations.ts` manually: retain the #101/#45 preference and clock translations; add the #78 `city.clear` and `city.retry` labels to **both** languages.
- Clear removes the temporary picker selection and emits `locationEdited`. The parent clears `selectedCity` and recomputes the clock, avoiding a stale selected city. A late search reply cannot restore a cleared selection.
- Each picker owns an independent native lookup instance. UI input is bounded by 80 Unicode scalar values, not UTF-16 code units; response limits and native error mapping remain fail-closed.

The temporary city and both clocks display **civil time only**. No calculated natal chart, birth-time conversion, historical timezone verification or astronomical ephemeris is supplied. The existing demo's planet positions remain fictional. No city, chart, account, secret, location history or cloud request is persisted or uploaded by this change.

## Code and verification

This is an **integration branch**, not a reimplementation of the source PRs. The baseline was ported from #78 pinned head `d3165717e21edee978f3a0ca20cd127c8dd250c0`. Since then, this integration intentionally changed the city picker component/template to assign unique DOM IDs, updated two imported source-contract tests to reflect its parent `onCityEdited()` clock-reset handler, merged the translation dictionary, and added focused integration and accessibility tests. All other imported #78 files remain identical to that pinned head.

Focused integrated synthetic Node tests:

```sh
node --experimental-strip-types --test tests/city-clock-picker-integration.test.mjs
node --experimental-strip-types --test tests/offline-city-picker-dom-ids.test.mjs
node --experimental-strip-types --test tests/offline-city-picker-state.test.mjs tests/offline-city-picker-retry.test.mjs tests/offline-city-picker-integration.test.mjs
node --experimental-strip-types --test tests/offline-place-search.test.mjs tests/offline-place-ipc-boundaries.test.mjs tests/offline-city-selection.test.mjs
node --experimental-strip-types --test tests/device-clock.test.mjs tests/selected-city-clock.test.mjs
npm test
npm run build:ui
```

The new cross-feature tests check Italian/English clock preview after selecting/clearing a city, stale native response cancellation, clock unavailable/recovery, dictionary-key parity and Angular parent/picker event wiring. All source-level tests use **synthetic records**.

A real Windows test must additionally check:
1. IT/EN preferences survive close/reopen; device and city clocks stay distinct.
2. Choose a packaged-catalog city and show its current IANA civil time; clear it and verify the city clock disappears without returning on inspector reopen.
3. Retry after native busy/unavailable; cancel while requests are in flight, test duplicate-name cities and long international queries.
4. Browser preview and missing private catalog remain explicit unavailability states. Never add a path or unlicensed city dataset to frontend files.
5. Confirm CSS and WebView2 native package health separately from astronomy; check no chart redrawing on simple clock ticks.

## Merge and release guardrails

The feature stack crosses **#45 → #46 → #101**, plus the independent **#78**. **Do not merge #78 separately and also merge this full integration branch**, because both introduce the same city picker changes. Review one final integration path and rerun comparisons, Node/Angular tests and Windows smoke before any merge. No changes to `main`, production, backend authentication, Rust astronomy, assets or licensed city-pack storage. No automatic GitHub Actions, installer publishing or deploy.

## Accessibility hardening: instance-scoped combobox IDs

The original city picker used fixed HTML IDs (`offline-city-query`, `offline-city-options` and option indexes). Independent search requests were already isolated, but **two simultaneous instances could still collide in the DOM**: a visible label could focus another picker's input, and `aria-controls` / `aria-activedescendant` could refer to the wrong listbox or option.

The integration now creates one stable `OfflineCityPickerDomIds` set per Angular component instance. Label `for`, input ID, listbox ID and option IDs share its local prefix. Destroying/remounting a component allocates a fresh prefix. Generated IDs contain only a local sequence number, never a city name, birth record, coordinate or user data.

When no suggestions exist, `aria-controls` is absent rather than pointing to an `*ngIf`-removed listbox; `aria-expanded` remains false and the active-descendant reference is cleared by the existing picker state. A new `tests/offline-city-picker-dom-ids.test.mjs` covers two instances, stable IDs after rerenders, Angular wiring and collapsed listbox behavior. The two imported #78 source-contract tests were also updated to assert this integration's `onCityEdited()` parent handler, which clears both the selected city and its clock; #78's original direct assignment assertion is no longer valid here.

**Windows/WebView2 acceptance:** with two pickers in the same document, inspect unique DOM IDs and exercise both labels, independent arrow/Enter navigation, clearing, retry and Escape using keyboard and a screen reader. No native IPC or Windows release is implied by this source change.
