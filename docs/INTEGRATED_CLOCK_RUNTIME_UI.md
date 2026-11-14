# Clock + runtime recheck: integrated Desktop review candidate

Status: **synthetic prototype integration**, not a Windows release. This branch combines the changes from draft PRs [#236](https://github.com/Cesare-ml/virgostars-desktop/pull/236) and [#238](https://github.com/Cesare-ml/virgostars-desktop/pull/238), both based on main. Do not merge all three PRs independently.

## Integration

- The Angular Desktop component has **both** the clock `visibilitychange` listener and manual `checkRuntime()` Settings control.
- The hidden-window clock cancels its one-second interval; resuming samples actual wall time. Stale timer callbacks cannot alter the new generation.
- The read-only native probe accepts at most one pending manual request and prevents late IPC completions from updating a destroyed view.
- Component teardown disposes both resources and removes the visibility listener; neither service can revive the destroyed component.
- The Settings button is labeled in IT/EN and disabled while its single probe is pending.

All capabilities remain synthetic. No account login, cloud sync, new native IPC, astronomical calculation, storage, secrets or production network API is enabled. No dependency, Tauri permission, data asset or CPAL attribution is changed.

## Added regression coverage

`tests/desktop-clock-runtime-integration.test.mjs` exercises the two pure services together:

1. Hidden clock pause + wall-time resume while a native recheck is pending.
2. Closing the view while timer and IPC callbacks are still outstanding.
3. Failed native probe recovery without interrupting the live civil clock.

**Integration source contract:** `tests/desktop-clock-runtime-source.test.mjs` adds five dependency-free tests checking both lifecycles in the same Angular component: single registration, paired teardown, visibility pause/resume, bilingual disabled recheck and synthetic-only read-only status. Its assertions were inspected against the current GitHub source: **10/10 targeted static checks matched**. The committed new Node test itself has **not yet been executed in a full checkout**, so this is not a claim of five additional passing tests.

**Isolated local test evidence (Node 22.16.0):** **12/12** executable pure tests passed (3 clock scheduler regressions, 3 combined integration cases, 6 runtime controller behavior cases). The 2 new clock regressions **failed against the prior code and passed after** guarding the scheduler error/null-handle paths against reentrant `pause()`. Source and test Git blob SHA-1 identities were checked against GitHub. Standalone TypeScript compilation of the runtime controller + protocol passed with `tsc 5.8.3`. The separate UI-source contract test requires additional Angular files absent from the isolated mirror and was **not executed**; neither were the complete checkout, Angular/Tauri builds or Windows GUI smoke.

## Reviewer acceptance sequence

From a checkout of this integration branch, with the public sibling `astrological-charts` library built as documented in README:

```sh
node --experimental-strip-types --test tests/desktop-clock-runtime-integration.test.mjs tests/desktop-clock-runtime-source.test.mjs tests/device-clock-visibility.test.mjs tests/device-clock-paused-scheduler.test.mjs tests/runtime-check-controller.test.mjs
npm test
npm run build:ui
```

Then verify on Windows WebView2 in `npm run tauri:dev`: opening Settings, clicking Recheck, displaying native synthetic status; minimizing/hiding and restoring the window; observing the city clock's timezone and ensuring no duplicate ticking. Also verify browser preview labels as browser-only. A successful check does not prove any real astronomy integration.

## Merge coordination

This is an **alternative combined integration candidate**, not an automatically approved merge. Review changes against related open PRs that touch `desktop-app.component.ts` (especially UI retry/clock accessibility PRs). Prefer merging **either** the two source PRs with a reviewed conflict resolution **or** this combined candidate, not all three unconditionally. Main and releases remain untouched until explicit maintainer approval.
