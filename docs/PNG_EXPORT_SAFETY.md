# Synthetic chart PNG export safety

Status: **implemented transport guard** for the existing fictional chart PNG export. This is not a real-astronomy integration, secure chart storage, a signed release or a promise of valid image pixels.

## Current behavior

The public Charts renderer's `GraficoRenderService.generaImmagine()` is expected to return a `data:image/png;base64,` URL from a local canvas. Before assigning the URL to an `<a download>` element, Desktop now requires:

- the exact PNG data-URL prefix (no remote, blob, HTML or SVG URLs);
- a bounded base64 payload (maximum 32 MiB of encoded data), with valid alphabet and padding shape;
- a PNG signature, an IHDR first chunk of length 13, positive width/height at most 16,384 pixels, spec-permitted color type/bit-depth/compression/filter/interlace values, and the IHDR CRC32;
- a filename assembled from allowed demonstration modes/themes, always prefixed `virgostars-synthetic-`.

On export failure, the UI now shows a translated PNG-specific retry message without marking the already-rendered chart unavailable. A chart-rendering failure still has a separate renderer error state. The guard avoids logging raw image data, birth records or file paths. It parses only the 33-byte PNG header, not the entire decoded image; the browser is responsible for interpreting the data URL. The guard verifies **only the IHDR chunk CRC32**, not the CRCs of later chunks, complete PNG validity, pixel integrity or the renderer's scientific accuracy. The 32 MiB limit is a protective application bound, not a measured performance threshold.

## Attached download-anchor lifecycle

The original PNG export used an unattached `document.createElement('a')` followed by `link.click()`. This can behave differently in embedded browsers, including WebView2, and left no explicit cleanup path if DOM access failed.

`src/app/png-download.ts` now isolates a **testable, synchronous browser download request**. The Angular caller first validates the `data:image/png;base64,` payload with `validatePngDataUrl` and the fixed synthetic filename with `syntheticPngFilename`, then supplies browser `createElement('a')` and `document.body.appendChild` to `requestSyntheticPngDownload`.

The helper sets `href` and `download`, **appends the anchor before calling `click()`**, and removes the temporary element in `finally` regardless of assignment, append or click failures (provided removal itself succeeds). If element creation fails, no element was allocated to remove. The PNG-specific, translated retry status handles exceptions without logging image bytes and without hiding a valid chart. No network, new Tauri command or persistent permission is involved.

A click returning is *not* proof the OS saved a PNG. Real WebView2 and browser download permission testing remains mandatory. An attached anchor does not imply that all browsers honor programmatic data-URL downloads.

### Focused validation (2026-11-13)

- **Node.js 22.16.0**: `node --experimental-strip-types --test tests/png-export-safety.test.mjs tests/png-download.test.mjs` → **16/16 PASS** in an isolated local mirror; the original eight PNG-safety cases and eight new anchor lifecycle cases were run together.
- **TypeScript 5.8.3 strict standalone**: `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/png-download.ts` → **PASS**.
- **Exact tested Git blob hashes matched GitHub:** `src/app/png-export-safety.ts` `147ec126d6727999c8fb6c5f9fd4d31a8da5123e`; its original tests `dee8f78272450082a139a5f8b72ea2c2c8e95400`; new download helper `dfeb2a0aada886ac60bd2a128725aefff3ad87eb`; new tests `745f2e7482c7050dc2827b01a9eff8f2c359ffa4`.
- The Angular component's invocation order and actual DOM wiring were checked by source review on GitHub; **no Angular template or Windows native build was executed**.

## Tests and follow-up

Use `node --experimental-strip-types --test tests/png-export-safety.test.mjs`. Isolated unit tests cover a normal data URL, unsafe schemes/MIME, malformed body, invalid header, dangerous dimensions, oversize and static synthetic filenames.

Before integration into a release, run `npm test`, `npm run build:ui`, a native Windows WebView2 smoke test and actual PNG export for all modes/themes, including error behavior and large screenshots. No GitHub Actions, production data or cloud services are required.

## IHDR integrity follow-up (2026-11-13)

The fixed-header validator now checks the PNG specification's IHDR field combinations and CRC32 before requesting a browser download. CRC calculation touches only the 17-byte IHDR type-and-data span, keeping the existing constant-space, header-only behavior and the 32 MiB encoded-payload upper bound. It returns the accepted data URL unchanged.

Synthetic tests deliberately recompute CRC when mutating dimensions and header fields, so they exercise the intended checks independently; a separate test corrupts the stored IHDR CRC. This is **not** a full PNG decoder or a file-save confirmation. The Windows WebView2 export smoke test and full Angular build remain necessary before release.

### Focused verification (IHDR follow-up)

- **Node.js v22.16.0:** `node --experimental-strip-types --test tests/png-export-safety.test.mjs` — **11 passed, 0 failed** in a minimal isolated mirror.
- **TypeScript v5.8.3:** strict standalone `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM` — **passed**, with a matching minimal `ChartMode`/`UiTheme` type stub.
- The tested source and test files were verified byte-for-byte against their GitHub blob SHAs: `e2de774777b6e09717f5d0ac468532f7fc80d9be` and `f834bd7a2e276881960691b607a537acd6f19a5f`.
- **Not executed:** repository-wide `npm test`, Angular bundle/build, Tauri/Rust build, or Windows WebView2 GUI/export smoke.
