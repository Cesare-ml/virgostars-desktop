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

This is an **integration branch**, not a reimplementation of the source PRs. The baseline was ported from #78 pinned head `d3165717e21edee978f3a0ca20cd127c8dd250c0`. Since then, this integration intentionally changed the city picker component/template to assign unique DOM IDs and synchronize external parent selection changes, added a small pure state reconciler, updated two imported source-contract tests to reflect its parent `onCityEdited()` clock-reset handler, merged the translation dictionary, and added focused integration, accessibility and parent-state tests. The imported source is no longer entirely byte-identical to #78; review the integration diff rather than relying on the earlier blob-match count.

Focused integrated synthetic Node tests:

```sh
node --experimental-strip-types --test tests/city-clock-picker-integration.test.mjs
node --experimental-strip-types --test tests/offline-city-picker-dom-ids.test.mjs
node --experimental-strip-types --test tests/offline-city-parent-reconciliation.test.mjs
node --experimental-strip-types --test tests/offline-city-ime-composition.test.mjs
node --experimental-strip-types --test tests/offline-city-timer-failure.test.mjs
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

## Parent-driven city selection reconciliation (2026-11-13)

The parent `selectedPlace` input is authoritative when changed **externally**. Earlier, `ngOnChanges` only restored non-null places and ignored an external transition to `null`, which could leave an obsolete chosen place visible in the child even while the parent city clock had been cleared.

The child now invokes the independently testable `reconcileParentCitySelection` helper only for real `selectedPlace` input changes:
- A non-null parent place restores the temporary local selection and cancels pending obsolete search results.
- A null parent place clears an **already selected** local place, including its query and results, without sending `locationEdited` back to the parent.
- If the user already edited the city name, local selection is already null: a parent null event **does not erase the typed query or its pending search**, and avoids extra notifications and native calls.
- Null-to-null changes when the picker has no selection are no-ops.

`tests/offline-city-parent-reconciliation.test.mjs` adds five synthetic regression cases for city/clock removal, preserving an active typed query, rejecting late replies after an external city switch, no-op empty state and Angular lifecycle wiring. **5/5 original test bodies passed** against committed GitHub source in an isolated JavaScript V8 harness after removing TypeScript-only syntax and redirecting the one source file read; this is *not* a complete Node test runner execution, Angular build or Windows WebView2 acceptance. The full checkout must run the explicit test command above and check parent-driven selection clearing while the inspector stays mounted.

No persisted locations, personal birth records, network requests, native IPC privileges or astronomy calculations are introduced.

## IME-safe city input (2026-11-13)

The city picker must allow text composition in keyboard input methods (e.g. Chinese, Japanese or Korean) without firing searches for provisional candidates or replacing the browser's in-progress text with the normalized value. The Angular input now listens for `compositionstart` and `compositionend`. While composing, it ignores interim `input` events and suppresses combobox Arrow/Enter/Escape actions, including the WebView2/Windows legacy IME key code `229`. Only after composition finishes does it pass the final query through the existing bounded Unicode search state and emit `locationEdited` once.

Some browsers dispatch an extra final `input` immediately after `compositionend`: the new pure `shouldCommitCityQuery` guard prevents re-scheduling the same query twice when there is no selected place to invalidate. No query substring, input method candidate or city name is logged or persisted.

**Local QA actually performed:** `node --experimental-strip-types --test --test-name-pattern='unfinished IME|compositionend|IME Enter|Unicode scalar' tests/offline-city-ime-composition.test.mjs` ran **4/4 behavior cases** with Node.js **22.16.0** against locally mirrored files whose Git hashes matched the exact GitHub blobs. The `src/app/offline-city-input-events.ts` helper passed isolated TypeScript 5.8.3 strict compilation. A fifth source-wiring test was checked with the committed Angular component/template in an isolated V8 harness (**5/5 source+behavior test bodies passed there**), but **full Node execution of the fifth case, Angular build and real Windows IME interaction remain unverified**.

**Manual Windows acceptance:** with a Japanese or Chinese IME, type and convert multi-character city text. Ensure Enter confirms an IME candidate instead of choosing a city, no native search runs during composition, final query searches once, the visible input remains untruncated during composition, and a following input event does not duplicate the query. Also verify Latin keyboards and keyboard-only navigation still work after IME completion.

## Debounce timer failure containment (2026-11-13)

The city search state now handles injectable timer scheduler failures without raising UI exceptions or leaving the picker indefinitely in `typing`. A scheduler that throws or returns an absent handle settles in explicit `unavailable` state, allowing the existing manual Retry control to attempt a fresh search. Timer handle `0` remains valid. Previously selected city state is cleared on an edited query even when scheduling fails.

On cancel, `abortPending` increments the generation **before** timer/lookup cleanup and resets the stored handle. If timer cancellation or lookup-scope cancellation throws, both errors are contained; the generation guard prevents a late callback or Promise response from restoring a cleared city. Error details, paths and native internals are never emitted to the UI.

Test file: `tests/offline-city-timer-failure.test.mjs` (5 synthetic cases). **5/5 test bodies passed** in an isolated V8 JavaScript harness on the exact committed GitHub state/test source after removing TypeScript-only syntax. In addition, **13/13 existing** city picker state test bodies passed under that same isolated harness against the new state implementation. This is **not** equivalent to a complete `node --test`, `npm test`, Angular or packaged Windows/WebView2 run.

Manual acceptance: simulate a failed debounce timer, verify localized transient error and Retry; simulate timer cancellation failure on Clear, and ensure the city clock and selected-city label disappear and a late reply never recreates them. Verify normal keyboard and IME search and a timer whose handle is `0`.

## Main-branch reconciliation checkpoint (2026-11-13)

The old stacked clock dependency chain **#45 → #46 → #101** has since been merged to `main`. This integration PR **#107 now directly targets `main`** as a draft. A two-parent **feature-branch-only** merge commit `b01fce10849b42af92342f73208921ea1562bf98` incorporated then-main head `fdb83043953c070c03b005a7965fb73c6fb6b022` into the existing #107 head `b2d97148a761af5ce421ce5bd7692414ace9e517`.

The GitHub history comparison from the clock parent showed **zero overlapping changed paths** between current-main additions and the city's 22 changes, so the integration tree was built on the exact `main` tree and overlaid **only** those 22 city-feature paths. The update was a non-forced fast-forward of the feature ref with an expected-SHA lease. Read-back `main...#107` immediately afterward showed 40 commits ahead, 0 behind and exactly the 22 city-feature files. `main` itself was not modified.

This proves source provenance and avoids discarding other merged work, **not** a tested executable. Before marking the PR ready or merging, run the full test suite, bundled CSS/JS/native IPC verification and `npm run build:ui` from a complete Windows checkout. Test the actual Tauri/WebView2 UI with an installed, authorized city catalog, without exposing its private files. Verify any newer `main` drift again at merge time. Keep draft until these gates and the maintainer review are complete.

**Important:** The top-level introduction above describes historical branch composition. This checkpoint is authoritative for current PR base/merge status. Do not merge the superseded independent #78 city picker in addition to #107 without deduplication.
