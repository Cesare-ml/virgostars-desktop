# Synthetic chart PNG export safety

Status: **implemented transport guard** for the existing fictional chart PNG export. This is not a real-astronomy integration, secure chart storage, a signed release or a promise of valid image pixels.

## Current behavior

The public Charts renderer's `GraficoRenderService.generaImmagine()` is expected to return a `data:image/png;base64,` URL from a local canvas. Before assigning the URL to an `<a download>` element, Desktop now requires:

- the exact PNG data-URL prefix (no remote, blob, HTML or SVG URLs);
- a bounded base64 payload (maximum 32 MiB of encoded data), with valid alphabet and padding shape;
- a PNG signature, IHDR first chunk of length 13 and positive width/height at most 16,384 pixels;
- a filename assembled from allowed demonstration modes/themes, always prefixed `virgostars-synthetic-`.

On failure the existing translated generic chart-error UI is shown. The guard avoids logging raw image data, birth records or file paths. It parses only the 33-byte PNG header, not the entire decoded image; the browser is responsible for interpreting the data URL and this guard **does not verify** chunk CRCs, full PNG validity or the renderer's scientific accuracy. The 32 MiB limit is a protective application bound, not a measured performance threshold.

## Tests and follow-up

Use `node --experimental-strip-types --test tests/png-export-safety.test.mjs`. Isolated unit tests cover a normal data URL, unsafe schemes/MIME, malformed body, invalid header, dangerous dimensions, oversize and static synthetic filenames.

Before integration into a release, run `npm test`, `npm run build:ui`, a native Windows WebView2 smoke test and actual PNG export for all modes/themes, including error behavior and large screenshots. No GitHub Actions, production data or cloud services are required.
