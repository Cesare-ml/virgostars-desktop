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

**Isolated local test evidence (Node 22.16.0):** all **3/3** integration cases passed on a local mirror of the relevant source modules; **6/6** runtime-controller behavior cases passed separately. The complete repo and Angular/Tauri GUI were not available in that environment, so this is **not** a full-checkout build or native smoke test.

## Reviewer acceptance sequence

From a checkout of this integration branch, with the public sibling `astrological-charts` library built as documented in README:

```sh
node --experimental-strip-types --test tests/desktop-clock-runtime-integration.test.mjs tests/device-clock-visibility.test.mjs tests/runtime-check-controller.test.mjs
npm test
npm run build:ui
```

Then verify on Windows WebView2 in `npm run tauri:dev`: opening Settings, clicking Recheck, displaying native synthetic status; minimizing/hiding and restoring the window; observing the city clock's timezone and ensuring no duplicate ticking. Also verify browser preview labels as browser-only. A successful check does not prove any real astronomy integration.

## Merge coordination

This is an **alternative combined integration candidate**, not an automatically approved merge. Review changes against related open PRs that touch `desktop-app.component.ts` (especially UI retry/clock accessibility PRs). Prefer merging **either** the two source PRs with a reviewed conflict resolution **or** this combined candidate, not all three unconditionally. Main and releases remain untouched until explicit maintainer approval.
