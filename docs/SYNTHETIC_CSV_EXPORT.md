# Fictional chart CSV export — desktop laboratory

Status: **Prototype, locally tested serializer; native Windows/WebView2 download not yet verified.**

The desktop chart-first demo now offers **Export demo CSV / Esporta CSV demo** in the bottom chart toolbar. The button is active **only for the natal view**, because Transit, Synastry and Latitudes are different renderer views and the current inspector lists just the base fictional natal fixture. It never exports a real person's birth data.

## User-facing behavior

1. Open the synthetic natal chart, optionally offline.
2. Select **Export demo CSV**. The app prepares a short CSV in memory, creates a temporary Blob URL, and requests a browser download using a normal anchor click.
3. The footer reports that a download was **requested**, not that the operating system definitely saved it. Browser/WebView2 download behavior must be confirmed on a Windows build.
4. Filename: virgostars-FICTIONAL-NOT-CALCULATED.csv. No account, local database, cloud API, authentication token or native Tauri command is used. The temporary Blob URL is scheduled for revocation after 30 seconds; if the browser click or timer setup fails, cleanup occurs immediately. The status notice clears when the user switches chart modes.

## Data contract

Exactly 22 deliberately fictional records (ten named planets + houses 1–12), in deterministic canonical order, independent of UI language:

~~~csv
record_type,object_name,longitude_degrees,data_quality
planet,Sun,19.3,FICTIONAL_NOT_CALCULATED
...
house,1,103.0,FICTIONAL_NOT_CALCULATED
~~~

All degrees are longitude values from the existing *fictional* inspector fixture, never a Rust ephemeris result. The serializer uses CRLF, dot decimal separators and one decimal place. Unknown names, duplicate/missing/excess records, nonfinite or out-of-range coordinates, negative zero and coordinates that require rounding to one decimal are rejected without partial output or data in error messages. Fixed names and validation prevent spreadsheet formula injection.

The serializer is intentionally isolated from grafici-astrologici: it formats supplied fixture values but neither calculates astronomy nor accesses the app's future local profile, sync or storage components. The current CSV is not a reliable natal chart, a substitute for validated positions, or a data-export route for real records. A real data-export feature would require its own explicit authorization, privacy review, versioned schema and Rust-derived numerical quality metadata.

## Checks

Run from an authorized checkout with Node.js 22.12+ or 24 and TypeScript 5.8:

~~~sh
node --experimental-strip-types --test tests/synthetic-csv-export.test.mjs tests/synthetic-csv-download.test.mjs tests/synthetic-csv-ui-contract.test.mjs
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/synthetic-csv-export.ts src/app/synthetic-csv-download.ts
npm run build:ui
~~~

The pre-existing standalone serializer was locally tested with **23/23 passing Node tests**. The new isolated, byte-identical download helper and its tests have been run with **Node.js 22.16.0: 5/5 passing** and **TypeScript 5.8.3 strict check: passed** (Git blob SHA verified against the GitHub branch). The UI contract tests were updated, but **not executed as a complete repository suite**. These checks do **not** replace the complete Angular build. A Windows Tauri/WebView2 manual smoke is still required to confirm actual CSV downloading, browser permissions, toolbar layout at small widths, screen-reader messages and offline operation.

## Boundaries and integration

- No server calls, production records, new IPC/capabilities, new dependencies, local persistence or automatic telemetry.
- No actual ephemerides or user birth information in the emitted file.
- PNG export and upstream chart renderer remain untouched.
- The browser request and Blob URL cleanup now use a dependency-free, injected port. A failed create/click/schedule path cannot leave an allocated URL undisposed by the helper; the port uses the existing fixed fictional filename only.
- The new feature is separate from the natal editor, private city catalog, SQLCipher and scientific calculation PR stacks.
- Do not publish a release or merge without normal build and platform review.
