# Integration: fictional chart geometry and CSV export

Status: **draft integration**, dependent on the fictional CSV export PR #82 and borrowing the reviewed fixture changes from PR #87. No scientific ephemeris readiness is claimed.

## Purpose

The existing desktop UI renders ten fictional planets and twelve fictional houses; an independent draft adds a download of those inspector entries as CSV. Both features must use **one** set of synthetic coordinates. This integration tests that the base chart, inspector arrays and exported table remain aligned. Overlay shifts are not exported as a natal chart.

## Branch and merge order

- Integration branch: `integrate/synthetic-csv-fixture-20261113`, based on `feat/synthetic-chart-csv-export-20261113` (PR #82).
- Files `src/app/fictional-geometry.ts`, `src/app/fictional-fixture.ts`, `tests/fictional-geometry.test.mjs`, and `docs/FICTIONAL_FIXTURE_INVARIANTS.md` are copied **byte-identically** from `fix/fictional-longitude-invariants-20261113` (PR #87).
- A new cross-module regression test proves that the CSV's ten planet and twelve house values equal the chart's base synthetic coordinates; it also ensures transit/synastry shifts do not leak into the natal export.
- Merge policy: **do not independently merge PR #87 plus the integrated PR**, as that duplicates the same fixture changes. Reconcile integration against any later changes in either parent PR. No main merge until explicit review and full validation.

## Offline, minimal regression test

Run in an authorized checkout with Node.js 22+:

```sh
node --experimental-strip-types --test \
  tests/fictional-geometry.test.mjs \
  tests/synthetic-csv-export.test.mjs \
  tests/synthetic-csv-download.test.mjs \
  tests/synthetic-csv-geometry-integration.test.mjs \
  tests/synthetic-csv-ui-contract.test.mjs
npx tsc --noEmit --strict --target ES2022 --module ESNext \
  --moduleResolution bundler --lib ES2022,DOM \
  src/app/fictional-geometry.ts src/app/synthetic-csv-export.ts src/app/synthetic-csv-download.ts
```

Then run the complete `npm test` and `npm run build:ui` against the separately built `astrological-charts` package. Test in offline Windows Tauri/WebView2 on a normal and high-DPI display: chart/table agreement, all view modes, genuine PNG/CSV download behavior and Blob URL cleanup. These platform gates remain open.

## Boundaries

No real birth data, no astronomy calculation, no user profiles, no cloud/backend, no additional IPC, no storage, no external asset packaging or dependencies. The emitted CSV explicitly says `FICTIONAL_NOT_CALCULATED` on every row. Do not claim this prototype is a real natal chart or a released application.
