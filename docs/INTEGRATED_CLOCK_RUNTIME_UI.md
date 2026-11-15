# Clock + runtime recheck: integrated Desktop review candidate

Status: **synthetic prototype integration**, not a Windows release. This branch combines the changes from draft PRs [#236](https://github.com/Cesare-ml/virgostars-desktop/pull/236) and [#238](https://github.com/Cesare-ml/virgostars-desktop/pull/238), both based on main. Do not merge all three PRs independently.

## Integration

- The Angular Desktop component has **both** the clock `visibilitychange` listener and manual `checkRuntime()` Settings control.
- The hidden-window clock cancels its one-second interval; resuming samples actual wall time. Stale timer callbacks cannot alter the new generation.
- The device-clock text has a **two-entry, per-timestamp/locale cache** to avoid constructing repeated Intl formatters during unrelated Angular change-detection passes. City zone text remains independently refreshed by the wall-time ticker; no time zone is cached indefinitely.
- The read-only native probe accepts at most one pending manual request and prevents late IPC completions from updating a destroyed view.
- Component teardown disposes both resources and removes the visibility listener; neither service can revive the destroyed component.
- The Settings button is labeled in IT/EN and disabled while its single probe is pending.

All capabilities remain synthetic. No account login, cloud sync, new native IPC, astronomical calculation, storage, secrets or production network API is enabled. No dependency, Tauri permission, data asset or CPAL attribution is changed.

## Added regression coverage

`tests/desktop-clock-runtime-integration.test.mjs` exercises the two pure services together:

1. Hidden clock pause + wall-time resume while a native recheck is pending.
2. Closing the view while timer and IPC callbacks are still outstanding.
3. Failed native probe recovery without interrupting the live civil clock.

**Clock formatting cache test:** 4 new isolated Node cases exercise repeated reads, locale/time invalidation, invalid clock recovery and stable formatting. **4/4 passed** locally with Node 22.16.0; the fetched GitHub source/test Git blob SHAs matched the files executed. The clock module and runtime controller passed an isolated `tsc --noEmit --strict` check with local type-only interface stubs. The full Angular build and Windows host remain unverified.

**Integration source contract:** `tests/desktop-clock-runtime-source.test.mjs` adds five dependency-free tests checking both lifecycles in the same Angular component: single registration, paired teardown, visibility pause/resume, bilingual disabled recheck and synthetic-only read-only status. Its assertions were inspected against the current GitHub source: **10/10 targeted static checks matched**. The committed new Node test itself has **not yet been executed in a full checkout**, so this is not a claim of five additional passing tests.

**Isolated local test evidence (Node 22.16.0):** **12/12** executable pure tests passed (3 clock scheduler regressions, 3 combined integration cases, 6 runtime controller behavior cases). The 2 new clock regressions **failed against the prior code and passed after** guarding the scheduler error/null-handle paths against reentrant `pause()`. Source and test Git blob SHA-1 identities were checked against GitHub. Standalone TypeScript compilation of the runtime controller + protocol passed with `tsc 5.8.3`. The separate UI-source contract test requires additional Angular files absent from the isolated mirror and was **not executed**; neither were the complete checkout, Angular/Tauri builds or Windows GUI smoke.

## Reviewer acceptance sequence

From a checkout of this integration branch, with the public sibling `astrological-charts` library built as documented in README:

```sh
node --experimental-strip-types --test tests/desktop-clock-runtime-integration.test.mjs tests/desktop-clock-runtime-source.test.mjs tests/device-clock-visibility.test.mjs tests/device-clock-paused-scheduler.test.mjs tests/device-clock-text-cache.test.mjs tests/runtime-check-controller.test.mjs
npm test
npm run build:ui
```

Then verify on Windows WebView2 in `npm run tauri:dev`: opening Settings, clicking Recheck, displaying native synthetic status; minimizing/hiding and restoring the window; observing the city clock's timezone and ensuring no duplicate ticking. Also verify browser preview labels as browser-only. A successful check does not prove any real astronomy integration.

## Merge coordination

This is an **alternative combined integration candidate**, not an automatically approved merge. Review changes against related open PRs that touch `desktop-app.component.ts` (especially UI retry/clock accessibility PRs). Prefer merging **either** the two source PRs with a reviewed conflict resolution **or** this combined candidate, not all three unconditionally. Main and releases remain untouched until explicit maintainer approval.

## Observer isolation and passive civil clocks (2026-11-14)

This integration also reconciles the independent observer-safety proposal [#133](https://github.com/Cesare-ml/virgostars-desktop/pull/133) and Angular-accessibility proposal [#144](https://github.com/Cesare-ml/virgostars-desktop/pull/144), without replacing their separate review history:

- `DeviceClock.emitChanged()` isolates errors from the UI observer after timestamp updates. A throwing callback cannot prevent interval registration, suppress invalid-time transitions or break future resume/ticks.
- Angular ignores `onCitySelected`, `onCityEdited`, and `toggleLanguage` events after component destruction; no dead-view change detection or city updates are scheduled.
- Both device and selected-city semantic `<time>` elements retain `clockInstantIso` and use `aria-live="off"`. They should not announce every second to assistive technology, but remain readable on demand.

### Isolated verification

The exact GitHub clock module was mirrored locally and verified by its Git blob SHA `1e5fb7b5e7cf54f4a3f0bfd3c66207a524934eaa`. The newly committed observer/lifecycle Node test blob is `48200e744fda86b85755a07af8e091cbb4ddf0e7`. On Node.js 22.16.0, **21/21** pure tests passed: 5 observer failure tests, 4 cache tests, 3 pause/start failure tests, 3 clock/runtime integration tests, and 6 runtime controller behavior tests (all in a synthetic local mirror). An isolated `tsc --noEmit --strict` check also passed for the clock, runtime controller and runtime protocol.

The integration's Angular source-contract file now has **8 cases**, including the disposed-event/accessibility rules. **10/10 GitHub read-back structural checks passed**, but the Angular source-contract Node file itself was **not executed in the local test mirror**; no full `npm test`, Angular/Charts build, Rust/Tauri compilation or Windows WebView2/screen-reader smoke test was run.

Run these checks from an authorized full checkout:

```sh
node --experimental-strip-types --test tests/device-clock-observer-lifecycle.test.mjs tests/device-clock.test.mjs tests/desktop-clock-runtime-source.test.mjs
npm test
npm run build:ui
```

Because #133, #144, #236, #238 and this PR overlap, review and merge **one reconciled set of overlapping changes**. Keep the originals open for provenance until maintainers choose the reviewed integration path. A clean GitHub merge check alone does not prove runtime/browser/Windows acceptance.

### Existing Node contract migration

The baseline `tests/device-clock-wiring.test.mjs` still asserted the obsolete inline clock callback and direct `formatDeviceClock()` UI getter, which are intentionally replaced by a stable visibility callback and the bounded text cache. The old test would fail despite correct current behavior. Its assertions now require the actual `onClockChanged` guard, visibility listener registration/removal, cached clock formatting, and passive semantic device time.

The original test's **three cases passed** under an isolated JavaScript V8 harness using the exact GitHub source files and their existing assertion bodies. The separate eight-case integration source test also passed in the same harness (**11/11 combined**, no failures). These checks are source-contract validation, **not a complete checkout Node test run, Angular compilation or Windows acceptance**.
