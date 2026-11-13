# Inspector / fictional geometry / CSV precision integration

Status: **Prototype / isolated Node-tested; Windows GUI unverified**.

## Purpose and merge direction

Three existing draft improvements touch the same synthetic chart experience:

1. **#82** adds a strictly fictional offline natal CSV export (22 rows, never real computed coordinates).
2. **#93** combines #82 with the geometry refactor from #87, so renderer, inspector and export share one deterministic base fixture.
3. **#83** adds fail-closed circular longitude formatting in the inspector, preserving source data.

This branch starts from **#93** and initially copied #83's pure formatter, tests and documentation byte-for-byte. A subsequent reviewed extension localizes the **display-only** decimal separator and adds tests. The inspector's `formatDegrees` adapter passes the active UI locale; all original #93 geometry, serializer and export behavior remains unchanged.

## User-facing behavior

- Planets and houses inspector show one-decimal ecliptic longitudes.
- A finite coordinate in `[0, 360)` that rounds to the circular boundary displays `0.0°` rather than an impossible `360.0°`.
- Invalid/non-finite/out-of-range coordinates display an unavailable dash. The formatter does not coerce strings, invent astronomy or silently normalize erroneous source coordinates.
- All **22 base fictional values** shown in the inspector have the same one-decimal **numeric value** as the offline CSV for the natal demonstration. The UI shows `19,3°` in Italian or `19.3°` in English; the CSV always uses `19.3` (decimal point, no degree symbol). Switching UI language never alters CSV bytes or scientific provenance.
- The CSV stays deliberately stricter: it refuses values not representable to one decimal and marks every row `FICTIONAL_NOT_CALCULATED`. It is not a birth-chart export and does not validate JPL or any ephemeris.

## Tests actually run (2026-11-13)

Using **Node.js 22.16.0** in a standalone local mirror with exact Git blob SHA identity for both new/preserved tests and all three pure modules:

```sh
node --experimental-strip-types --test --test-skip-pattern='actual desktop source' \
  tests/format-longitude.test.mjs tests/synthetic-inspector-csv-precision.test.mjs
tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler \
  src/app/fictional-geometry.ts src/app/format-longitude.ts src/app/synthetic-csv-export.ts
```

- **9/9 Node test cases PASS; 0 failures/skips in the filtered run** (5 formatter tests and 4 runtime CSV/geometry tests). The remaining 10th source-wiring test requires the complete checked-out Angular component/template, which is intentionally not present in that mirror. The run used the exact committed files; all checked Git blob IDs matched.
- TypeScript **5.8.3 strict standalone compilation PASS** for the three pure modules.
- **8/8** independent source assertions passed directly against actual GitHub component, template, fixture and committed test bytes. These are static checks, **not** the 8th Node test or an Angular compilation.
- Exact Git blob hashes in the tested mirror:
  - `src/app/fictional-geometry.ts`: `4cacbba4ee1147a7e59f4175dbf6b3927ee13fff`
  - `src/app/format-longitude.ts`: `599758d649a841a0df90a37e5597ea712b670961`
  - `src/app/synthetic-csv-export.ts`: `bd133f75a015d9523d9983e26799300f19a959e9`
  - `tests/format-longitude.test.mjs`: `3f14aa8376a89b39c84281ce79434db18faa8a92`
  - `tests/synthetic-inspector-csv-precision.test.mjs`: `4d4b6165a90eccceb52e04dae3b488573281bfff`

Not run: complete repository `npm test`, Angular strict compile against `astrological-charts`, native Rust/Cargo, Windows Tauri/WebView2, real CSV download through browser, or any scientific calculation.

## Integration boundaries

This integration PR targets **#93's feature branch**, not `main`. After review and complete build/native smoke, choose a single integration path for #83/#93/#87/#82; do not merge equivalent changes independently and then copy them again. Other shell UI PRs may edit the same Angular component: recompare source before eventual merge.

No new dependencies, network, accounts, storage, cloud API, personal birth data, licensed artwork, astronomical code, production, GitHub Actions, release, visibility or main merge. Keep as **Draft**.
