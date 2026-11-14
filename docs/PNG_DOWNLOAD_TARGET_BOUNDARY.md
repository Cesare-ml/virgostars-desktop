# Synthetic PNG download target boundary

**Status:** focused TypeScript guard and synthetic unit tests. This is not a native Windows/WebView2 export acceptance or proof that an image was saved.

## Threat model

The UI currently validates the renderer's PNG-shaped data URL using `validatePngDataUrl` and generates a fixed synthetic filename before calling `requestSyntheticPngDownload`. Future callers can bypass that upstream validation because the download port historically accepted plain strings.

The anchor-owning download function now **independently** requires a canonical `data:image/png;base64,` prefix, bounded base64 content without line terminators, and one of the eight fixed `virgostars-synthetic-<mode>-<theme>.png` names. Invalid inputs throw **before** the DOM adapter creates an anchor. The original append-click-remove cleanup behavior is unchanged for valid targets or adapter failures.

**This is defense in depth, not a second PNG parser:** the caller must still run `validatePngDataUrl` for PNG signature, IHDR dimensions and CRC, and the browser's click still does not prove that a file was written. It does not permit arbitrary birth-subject filenames or unvalidated real-chart exports.

## Verification

Focused local Node.js 22.16.0 run:

```sh
node --experimental-strip-types --test tests/png-download-boundary.test.mjs
tsc --noEmit --strict --target ES2022 --module ES2022 --moduleResolution bundler --lib ES2022,DOM src/app/png-download.ts
```

4/4 new test groups passed and standalone strict TypeScript check passed against the proposed source before upload. The repository-wide test suite, dependency-based Angular/Charts build, Rust/Tauri compile and Windows WebView2 click/save test were **not** run.

Before merging, execute `npm test`, `npm run build:ui` and a Windows offline export smoke check; coordinate with the still-open PNG export and UI integration PRs. No new dependencies, external/network requests, native IPC permissions, real charts, accounts, secrets, assets, licenses, releases or GitHub Actions. Keep as draft pending acceptance.
