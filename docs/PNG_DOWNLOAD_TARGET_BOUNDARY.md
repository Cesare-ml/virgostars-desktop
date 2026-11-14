# Synthetic PNG download target boundary

**Status:** focused TypeScript guard and synthetic unit tests. This is not a native Windows/WebView2 export acceptance or proof that an image was saved.

## Threat model

The UI currently validates the renderer's PNG-shaped data URL using `validatePngDataUrl` and generates a fixed synthetic filename before calling `requestSyntheticPngDownload`. Future callers can bypass that upstream validation because the download port historically accepted plain strings.

The anchor-owning download function now **independently** requires a canonical `data:image/png;base64,` prefix, bounded base64 content without line terminators, and one of the eight fixed `virgostars-synthetic-<mode>-<theme>.png` names. Invalid inputs throw **before** the DOM adapter creates an anchor. Successful requests still append → click → remove. When a download operation fails and anchor cleanup also fails, the first error is preserved; cleanup-only failures still propagate (combined with PR #189).

**This is defense in depth, not a second PNG parser:** the caller must still run `validatePngDataUrl` for PNG signature, IHDR dimensions and CRC, and the browser's click still does not prove that a file was written. It does not permit arbitrary birth-subject filenames or unvalidated real-chart exports.

## Verification

Focused local Node.js 22.16.0 run:

```sh
node --experimental-strip-types --test tests/png-download.test.mjs tests/png-download-boundary.test.mjs tests/png-download-error-precedence.test.mjs
tsc --noEmit --strict --target ES2022 --module ES2022 --moduleResolution bundler --lib ES2022,DOM src/app/png-download.ts
```

Integration retest on Node.js 22.16.0 (isolated local mirror): 8 existing download tests, 4 target-boundary tests and 6 error-precedence tests passed together (**18/18**). Strict standalone TypeScript 5.8.3 checking passed. Verified Git blob parity against this branch for the integrated helper `1da3131713e230d3fa9e2443e24b2ae675668b85`, original tests `745f2e7482c7050dc2827b01a9eff8f2c359ffa4`, boundary tests `f11972657d461ab7e771908c511436ed9c0193ca` and precedence tests `7dc84cb754a791f16898866b7ecbe8b9effd99f4`. The repository-wide test suite, dependency-based Angular/Charts build, Rust/Tauri compile and Windows WebView2 click/save test were **not** run.

Before merging, execute `npm test`, `npm run build:ui` and a Windows offline export smoke check; coordinate with the still-open PNG export and UI integration PRs. No new dependencies, external/network requests, native IPC permissions, real charts, accounts, secrets, assets, licenses, releases or GitHub Actions. Keep as draft pending acceptance.

## Canonical padding and allocation bound — 14 November 2026

A second review identified a subtle non-canonical Base64 case: unused bits of the final sextet can differ while decoding to **exactly the same image bytes**. The final download boundary now rejects nonzero unused bits for both one- and two-character padding, preserving a single canonical representation. It also checks the encoded URL length **before** slicing the large payload. The separate upstream PNG header/CRC validator remains mandatory.

**Actually executed on Node.js 22.16.0, isolated local mirror:**

```sh
node --experimental-strip-types --test tests/*.mjs
# 19 passed, 0 failed, 0 skipped
tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/png-download.ts
# passed
```

New regression demonstrates two different Base64 strings decoding to identical PNG bytes; the alternate spelling and invalid padded tails are rejected **before DOM access**. Exact source blob SHA `5fb785232f337ef35a0f66837f87db3b6f164d3b`, boundary test SHA `244ec7ae03599121ed24cb30069953587ce4551e`; both matched local tested copies. The previous 18/18 record remains historical. Whole-repository and Windows/WebView2 acceptance still pending.
