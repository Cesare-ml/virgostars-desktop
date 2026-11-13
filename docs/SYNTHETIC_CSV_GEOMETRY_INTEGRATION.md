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
  tests/synthetic-csv-browser-port.test.mjs \
  tests/synthetic-csv-export.test.mjs \
  tests/synthetic-csv-download.test.mjs \
  tests/synthetic-csv-geometry-integration.test.mjs \
  tests/synthetic-csv-ui-contract.test.mjs
npx tsc --noEmit --strict --target ES2022 --module ESNext \
  --moduleResolution bundler --lib ES2022,DOM \
  src/app/fictional-geometry.ts src/app/synthetic-csv-export.ts \
  src/app/synthetic-csv-download.ts src/app/synthetic-csv-browser-port.ts
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

### Browser adapter lifecycle and full error-path checks

The previously inline Angular browser operations were extracted into `src/app/synthetic-csv-browser-port.ts`, a typed, dependency-injected adapter for Blob creation, object URLs, temporary download anchors, and delayed URL cleanup. `desktop-app.component.ts` now supplies native `Blob`, `URL`, `document`, and `window.setTimeout` functions but does not own the anchor lifecycle. It retains the existing fictional-only export guard, fixed filename and status copy.

The adapter attempts temporary-anchor removal in `finally` even if assigning `href`/`download`, appending (including a partial attach) or clicking throws. If `remove()` itself throws, the caller still revokes the Blob URL immediately; successful DOM removal cannot be guaranteed in that pathological case. The existing `requestSyntheticCsvDownload` helper revokes a URL immediately if anchor creation, append, click or timer registration throws. A successful click delays URL revocation by 30 seconds so WebView2 has time to begin the browser download; this does **not** prove it was saved.

Added `tests/synthetic-csv-browser-port.test.mjs` with eleven focused tests: success plus Blob MIME/content, failures at Blob/URL/anchor/href/download/append/click/remove/timer boundaries, and independently deferred cleanup across repeated calls. Updated `tests/synthetic-csv-ui-contract.test.mjs` for the adapter wire-up and its source security constraints; the full UI contract test still needs the complete repository checkout.

**Actually verified in isolated local Node.js 22.16.0 mirror** (the files below matched their GitHub content-blob SHA-1): `node --experimental-strip-types --test tests/synthetic-csv-browser-port.test.mjs tests/synthetic-csv-download.test.mjs tests/fictional-fixture-runtime.test.mjs tests/fictional-geometry.test.mjs` reported **28/28 PASS** (11 + 5 + 3 + 9). `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/synthetic-csv-browser-port.ts src/app/synthetic-csv-download.ts src/app/fictional-geometry.ts src/app/synthetic-csv-export.ts` **PASS** (TypeScript 5.8.3).

- Browser adapter Git blob: `e4b5715fc51dec47e04cf3f9f673a2c15b8e61f2`.
- Browser adapter tests Git blob: `2fafe424f4dec24997d8dba6666b64d1f56a5736`.
- Existing fixture, geometry and download code were also executed without changes from their verified GitHub blobs.

**Still missing:** Angular template/strict compilation against the installed `astrological-charts` sibling; the entire `npm test` suite (including UI source-contract tests), real browser download permission and save behavior under Windows WebView2, CSP checks, PNG export and full release acceptance. The Node fake DOM port exercises code paths but is not a real WebView.

Then run the complete `npm test` and `npm run build:ui` against the separately built `astrological-charts` package. Test in offline Windows Tauri/WebView2 on a normal and high-DPI display: chart/table agreement, all view modes, genuine PNG/CSV download behavior and Blob URL cleanup. These platform gates remain open.

## Offline Windows CSV file acceptance verifier

To close the gap between an in-memory Blob request and an **actual** saved file, this branch includes a read-only command `scripts/verify-synthetic-csv-download.mjs` and `tests/verify-synthetic-csv-download.test.mjs`. After a real native Windows download, the user can select the file and compare its **exact bytes** to the expected fixed fictional CSV. No file content/path/username is printed; only a PASS/FAIL/usage status is emitted, with exit codes 0/1/2.

See [Windows CSV acceptance](SYNTHETIC_CSV_WINDOWS_ACCEPTANCE.md) for the manual WebView2 procedure and PowerShell command. A passing verifier is evidence of byte-identical local **fictional** output, not of an authentic chart or a successful Windows runtime test conducted by this PR.

- **Local Node.js 22.16.0:** 13/13 new verification tests PASS (exact content, tampered planet/house values, metadata flags, CRLF, BOM, truncation, appended bytes, symlinks, path safety and CLI diagnostics).
- Combined isolated mirror: **41/41 PASS** across existing geometry, actual fictional fixture with test-only graphics stub, browser adapter, browser URL cleanup and the new downloaded-file checker.
- All tested local files match GitHub blob hashes: verifier `5915ab816971dc6a3cd1df09354d0c632a708671`; new tests `3eb35c1ceb041470733b2e48037cbed8b5a622cd`; existing fixture/geometry/browser ports verified previously.
- Syntax checks `node --check` passed for the two new scripts. This tool does not perform an automated download or confirm Tauri/WebView2 or CSS behavior.

## Boundaries

No real birth data, no astronomy calculation, no user profiles, no cloud/backend, no additional IPC, no storage, no external asset packaging or dependencies. The emitted CSV explicitly says `FICTIONAL_NOT_CALCULATED` on every row. Do not claim this prototype is a real natal chart or a released application.
