# Cross-feature export regression: PNG, CSV, shortcuts and i18n

**Status:** Draft, source-level integration tests only. This does not prove a Windows build.

## Why this branch is test-only

While a separate integration of PNG export from draft PR #53 into the combined UI was being prepared, concurrent development **already added the exact same PNG validation/anchor modules and component wiring** to draft PR #103. The original source/test blob hashes on the current parent branch match PR #53. To avoid duplicate code and conflicting UI implementations, this branch now adds **only** `tests/synthetic-png-workspace-integration.test.mjs`, based on the current #103 branch.

The test explicitly protects:
- All four fictional modes and both light/dark themes retain fixed synthetic filenames, and each validated PNG is requested through a temporary attached, removed link;
- Unsafe renderer URLs and arbitrary filenames cannot reach the download adapter;
- Angular captures the original mode/theme before awaiting rendering, validates the PNG and filename **before** the DOM request, and retains the destroyed-state guard;
- Optional chart keyboard shortcuts remain focus-safe and do not replace the CSV export;
- Both planet/house inspector tables, the fictional CSV browser port and IT/EN labels remain wired after concurrent UI changes.

The original implementation is still reviewed through draft PRs #53, #93, #99 and #103. This test adds no astronomy calculations or real birth data.

## Verification evidence

With Node.js 22.16.0 and TypeScript 5.8.3:

```sh
node --experimental-strip-types --test \
  --test-skip-pattern='Angular PNG path|merged desktop|merged template' \
  tests/png-export-safety.test.mjs \
  tests/png-download.test.mjs \
  tests/synthetic-png-workspace-integration.test.mjs

tsc --noEmit --strict --target ES2022 --module ESNext \
  --moduleResolution bundler --lib ES2022,DOM \
  src/app/workspace-state.ts src/app/png-export-safety.ts src/app/png-download.ts
```

- **19/19 real Node tests PASS** in a deliberately partial local mirror: the 16 existing PNG format/DOM tests and 3 new behavior tests. The original modules/test files and the new integration test had byte-identical Git object hashes to the checked-in content.
- **24/24 direct source assertions PASS** against the real parent Angular component, template and translations fetched from GitHub. These correspond to the new source-only contract coverage, **not** to a real Angular build.
- **TypeScript strict standalone compilation PASS** with the actual `workspace-state.ts` definitions from the parent.

The three new source-reading test cases were **not executed through the Node runner** in the partial mirror because the complete Angular source tree was not mounted locally. The test is added to the existing `npm test` glob; run it from a full checkout to prove the source contracts under the actual test command.

Checked original Git blobs: `png-export-safety.ts` `147ec126d6727999c8fb6c5f9fd4d31a8da5123e`, `png-download.ts` `dfeb2a0aada886ac60bd2a128725aefff3ad87eb`, their tests `dee8f78272450082a139a5f8b72ea2c2c8e95400` and `745f2e7482c7050dc2827b01a9eff8f2c359ffa4`; `workspace-state.ts` `53f79fae35a2332a1b32fc3732665f5279980f3e`; this new integration test `e58cce4178cb089258674f05a6253f92b7ddf5ef`.

## Required manual acceptance

In a complete authorized Windows 11 checkout, run `npm.cmd test`, build the sibling `astrological-charts` library, `npm.cmd run build:ui`, `npm.cmd run verify:css`, native Tauri/Cargo checks and a real offline WebView2 smoke. Verify a PNG is actually saved for all required modes/themes (a successful click is insufficient), preserve the synthetic CSV's 22 fictional rows and IT/EN formatting, and check that shortcuts do not steal input focus.

If parent #103 moves during review, recompare it with this test-only branch. Do not independently merge overlapping original PNG code from #53 into the same final history without reconciliation.

No production, server, account, licensed artwork, astronomy, native IPC, repository visibility, license, deployment, release, automated Actions or `main` merge changes.
