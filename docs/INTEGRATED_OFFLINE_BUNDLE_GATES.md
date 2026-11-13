# Consolidated offline Angular bundle gate

**Status:** draft integration candidate; static source checks and isolated Node helper checks passed. Not a Windows/WebView2 release acceptance.

## Why consolidate?

Three previously separate draft PRs independently protected parts of the same offline Tauri Angular bundle, causing overlapping edits to `scripts/verify-offline-bundle.mjs`:

| Source draft | Integrated behavior |
| --- | --- |
| #86 | Quote-aware, active local CSS references; no disabled/alternate CSS, inert comment/template fake links, or CSP-blocked inline handlers |
| #49 | Exactly one local regular `main*.js` module, optional local polyfills, no inline/remote/symlinked entry scripts |
| #95 | Exactly one `<base href="/">` inside the document head, before any asset references; no external/relative/misplaced/inert base |
| #91 | Earlier overlapping CSS work; closed/unmerged, not separately copied |

The integrated `verifyOfflineBundle` validates **base → CSS → JavaScript → SHA-256-pinned assets** for both synthetic and approved private-artwork builds. Existing independent asset inspection remains intact. The returned report includes both stylesheet and JavaScript counts. `npm run build:ui` and `npm run build:ui:private` already call this verifier through their existing commands; there are no new build scripts or dependencies.

### Integration bug fixed

The approved-private-artwork fixture from #95 had been updated with a correct `<base>` but lacked the local Angular `main*.js` script required by #49. As a result, naïvely combining the PRs would break the positive private-mode test. The consolidated fixture now includes a synthetic local JS module, and asserts that private mode rejects a missing module and an incorrect base. Synthetic-mode integration tests additionally cover an inactive CSS link, a fake link inside a comment, and a missing JS module.

## Checks actually executed

- Node.js **v22.16.0**: `node --check` on the exact source files copied from the upstream GitHub commits for the base and JS helpers: **both pass**.
- Node.js **v22.16.0**: **22/22 passing isolated helper scenarios** against byte-identical copies of those two committed modules, including a synthetic HTML base + local JS combination. The executed local Git blob IDs match the integrated committed modules:
  - `verify-document-base.mjs`: `eec569b6a8588b2ed14ee9aa4bfdb4a3f2f95af3`
  - `verify-bundled-scripts.mjs`: `eb22438017f4530c72d60dcabbcaabdc5e82eda0`
- Read-only **17/17 static integration assertions** on the actual GitHub branch confirm the three imports and calls, their execution order, the return fields, the asset hash check, both test fixtures and negative regression coverage.
- The CSS verifier is reused **unchanged** from draft #86, whose 31 standalone synthetic cases were previously executed there. They have **not** been rerun as part of this consolidation.

**Not executed:** the complete repository `npm test` (including the integrated `tests/verify-offline-bundle.test.mjs` and `tests/private-assets.test.mjs`), Angular builds using the sibling renderer, real private-artwork bundle preparation, Rust/Tauri build, Windows native UI/WebView2/CSP/network inspection. The helper smoke does **not** prove an integrated native build works.

## Pre-merge acceptance commands

On an authorized complete workspace with the upstream Charts package prepared:

```powershell
npm.cmd test
npm.cmd run build:ui
npm.cmd run verify:bundle
npm.cmd run verify:css
```

For a rights-approved private artwork pack only:

```powershell
npm.cmd run build:ui:private
npm.cmd run verify:bundle:private
```

Then run the project's read-only Windows doctor, compile Tauri as authorized, disconnect development servers and the Internet, and inspect the actual WebView2 asset requests, chart layout, CSS, JavaScript, CSP console and native runtime. No success claim is made for unexecuted acceptance gates.

## Remaining coordination

- Treat this PR as the **candidate consolidation** of #49, #86 and #95; do not merge those individual implementations separately after this branch without reviewing the overlap. Leave original PRs open until their coverage is confirmed in a full checkout and reviewed.
- #72 checks different classes of packaged artifacts (unapproved extras and sensitive filenames) and should follow as a separate compatible gate.
- #75 checks the Windows PE executable after native compilation; this build-artifact verification does not replace it.
- No accounts, user birth data, production backend, privileged native IPC, astronomy, storage migrations, release, GitHub Actions, license, visibility or deployment changes.
