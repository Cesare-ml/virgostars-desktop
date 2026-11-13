# Inspector / fictional geometry / CSV precision integration

Status: **Prototype / isolated Node-tested; Windows GUI unverified**.

## Purpose and merge direction

Three existing draft improvements touch the same synthetic chart experience:

1. **#82** adds a strictly fictional offline natal CSV export (22 rows, never real computed coordinates).
2. **#93** combines #82 with the geometry refactor from #87, so renderer, inspector and export share one deterministic base fixture.
3. **#83** adds fail-closed circular longitude formatting in the inspector, preserving source data.

This branch starts from **#93** and copies #83's pure formatter, its original unit tests and its original documentation byte-for-byte. It changes only the inspector's existing `formatDegrees` adapter to call the formatter; all original #93 geometry, serializer and export behavior is unchanged. It adds a focused cross-module regression suite.

## User-facing behavior

- Planets and houses inspector show one-decimal ecliptic longitudes.
- A finite coordinate in `[0, 360)` that rounds to the circular boundary displays `0.0°` rather than an impossible `360.0°`.
- Invalid/non-finite/out-of-range coordinates display an unavailable dash. The formatter does not coerce strings, invent astronomy or silently normalize erroneous source coordinates.
- All **22 base fictional values** shown in the inspector have the same one-decimal displayed number as the offline CSV for the natal demonstration.
- The CSV stays deliberately stricter: it refuses values not representable to one decimal and marks every row `FICTIONAL_NOT_CALCULATED`. It is not a birth-chart export and does not validate JPL or any ephemeris.

## Tests actually run (2026-11-13)

Using **Node.js 22.16.0** in a standalone local mirror with exact Git blob SHA identity for both new/preserved tests and all three pure modules:

```sh
node --experimental-strip-types --test --test-skip-pattern='actual desktop source' \
  tests/format-longitude.test.mjs tests/synthetic-inspector-csv-precision.test.mjs
tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler \
  src/app/fictional-geometry.ts src/app/format-longitude.ts src/app/synthetic-csv-export.ts
```

- **7/7 Node test cases PASS; 0 failures/skips in the filtered run.** The remaining 8th new source-wiring test requires the complete checked-out Angular component/template, which is intentionally not present in that mirror.
- TypeScript **5.8.3 strict standalone compilation PASS** for the three pure modules.
- **8/8** independent source assertions passed directly against actual GitHub component, template, fixture and committed test bytes. These are static checks, **not** the 8th Node test or an Angular compilation.
- Exact Git blob hashes in the tested mirror:
  - `src/app/fictional-geometry.ts`: `4cacbba4ee1147a7e59f4175dbf6b3927ee13fff`
  - `src/app/format-longitude.ts`: `9cd75b9f7957ddba6cc6331d655264cedcf41ad3`
  - `src/app/synthetic-csv-export.ts`: `bd133f75a015d9523d9983e26799300f19a959e9`
  - `tests/format-longitude.test.mjs`: `b3b371321c56aa9671850abadc8abd4b10ffbd31`
  - `tests/synthetic-inspector-csv-precision.test.mjs`: `06db219cd212db0bf91ff471560e475710bb6ee3`

Not run: complete repository `npm test`, Angular strict compile against `astrological-charts`, native Rust/Cargo, Windows Tauri/WebView2, real CSV download through browser, or any scientific calculation.

## Integration boundaries

This integration PR targets **#93's feature branch**, not `main`. After review and complete build/native smoke, choose a single integration path for #83/#93/#87/#82; do not merge equivalent changes independently and then copy them again. Other shell UI PRs may edit the same Angular component: recompare source before eventual merge.

No new dependencies, network, accounts, storage, cloud API, personal birth data, licensed artwork, astronomical code, production, GitHub Actions, release, visibility or main merge. Keep as **Draft**.
