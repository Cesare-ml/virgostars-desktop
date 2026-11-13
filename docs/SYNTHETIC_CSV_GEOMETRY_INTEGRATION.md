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
  tests/fictional-fixture-runtime.test.mjs \
  tests/synthetic-csv-export.test.mjs \
  tests/synthetic-csv-download.test.mjs \
  tests/synthetic-csv-geometry-integration.test.mjs \
  tests/synthetic-csv-ui-contract.test.mjs
npx tsc --noEmit --strict --target ES2022 --module ESNext \
  --moduleResolution bundler --lib ES2022,DOM \
  src/app/fictional-geometry.ts src/app/synthetic-csv-export.ts src/app/synthetic-csv-download.ts
```

### Verified in an isolated Node.js 22.16.0 mirror

The checked-out test copies matched their GitHub blob SHA-1 values before execution (geometry `4cacbba4ee1147a7e59f4175dbf6b3927ee13fff`, inherited geometry tests `bfc15a17e79f26c565e21e30b7b9407b79d3de25`, integration tests `252d5530567fb12f3f042bf23fe3de920f1008c0`).

- Three runtime CSV/geometry assertions passed; the fourth (reading the actual Angular component and renderer-backed fixture source) was checked as seven direct GitHub source assertions instead of executing it in the partial mirror.
- Eight of the inherited geometry tests passed; the ninth depends on the full source checkout and was not executed in that mirror.
- All five inherited browser-download lifecycle tests passed.
- Strict, standalone TypeScript 5.8.3 compilation passed for the pure geometry, CSV serializer and browser-download helper.
- All data remain explicitly fictional. These tests do not establish JavaScript/Angular package compatibility, real WebView2 rendering or real astronomical accuracy.

### Further verification: actual synthetic fixture functions

The additional `tests/fictional-fixture-runtime.test.mjs` now loads and executes the original `src/app/fictional-fixture.ts` (Git blob `453d7ad078e168bf8011e5b7e135263a5307993e`), instead of relying solely on static inspection. A narrowly scoped Node `module.register` resolution hook from `tests/helpers/fixture-renderer-loader.mjs` replaces **only** the external `grafici-astrologici` `TemaRender` constructor with an empty test class, and resolves the existing extensionless geometry import. All original geometry, inspector functions, chart fixture construction and CSV encoding run unchanged. No application, network, artwork or real renderer code is mocked or invoked.

The three new tests directly compare the actual `makeFictionalTheme(0)`, `fictionalPlanets()`, `fictionalHouses()` and resulting 22-row CSV, prove the renderer gets a mutable **copy** of otherwise frozen cusps, and verify shift isolation for 23°/58° overlays.

**Local, isolated test evidence (Node 22.16.0):** `node --experimental-strip-types --test tests/fictional-fixture-runtime.test.mjs tests/fictional-geometry.test.mjs tests/synthetic-csv-download.test.mjs` completed **17/17 PASS** (new fixture tests 3, geometry tests 9, download tests 5). Standalone strict TypeScript 5.8.3 for the pure geometry/CSV/download modules **PASS**. Executed file contents matched exact GitHub blob hashes: fixture `453d7ad078e168bf8011e5b7e135263a5307993e`, geometry `4cacbba4ee1147a7e59f4175dbf6b3927ee13fff`, new test `6fe896c311671615bb19f94f21a4f53dd85d765f` and test loader `ecde57654208822ab912ac01efd2b1609d25b523`.

The partial test mirror lacked the full Angular component source, so the source-only fourth `synthetic-csv-geometry-integration` test could **not** complete in that mirror; do not interpret its missing-file failure as an application regression or report the complete suite as passing. It must be run in a full checkout. The mocked constructor deliberately cannot establish real `grafici-astrologici` runtime compatibility.

Then run the complete `npm test` and `npm run build:ui` against the separately built `astrological-charts` package. Test in offline Windows Tauri/WebView2 on a normal and high-DPI display: chart/table agreement, all view modes, genuine PNG/CSV download behavior and Blob URL cleanup. These platform gates remain open.

## Boundaries

No real birth data, no astronomy calculation, no user profiles, no cloud/backend, no additional IPC, no storage, no external asset packaging or dependencies. The emitted CSV explicitly says `FICTIONAL_NOT_CALCULATED` on every row. Do not claim this prototype is a real natal chart or a released application.
