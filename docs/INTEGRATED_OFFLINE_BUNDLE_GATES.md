# Consolidated offline Angular bundle gate

**Status:** draft integration candidate; static source checks and isolated Node helper checks passed. Not a Windows/WebView2 release acceptance.

## Why consolidate?

Three previously separate draft PRs independently protected parts of the same offline Tauri Angular bundle, causing overlapping edits to `scripts/verify-offline-bundle.mjs`:

| Source draft | Integrated behavior |
| --- | --- |
| #86 | Quote-aware, active local CSS references; no disabled/alternate CSS, inert comment/template fake links, or CSP-blocked inline handlers |
| #49 | Exactly one **active HTML** local regular `main*.js` module, optional local polyfills, no inline/remote/symlinked entry scripts or fake executable links inside comments, templates, textarea or quoted attributes |
| #95 | Exactly one `<base href="/">` inside the document head, before any asset references; no external/relative/misplaced/inert base |
| #91 | Earlier overlapping CSS work; closed/unmerged, not separately copied |

The integrated `verifyOfflineBundle` validates **base → CSS → JavaScript → SHA-256-pinned assets** for both synthetic and approved private-artwork builds. Both `verify:bundle` and `verify:bundle:private` then run the additional **read-only browser-output privacy allowlist** using `npm run verify:privacy`. Packaging fails if either stage fails. Existing independent asset inspection remains intact. The returned report includes both stylesheet and JavaScript counts. `npm run build:ui` and `npm run build:ui:private` already call this verifier through their existing commands; there are no new build scripts or dependencies.

### Integration bug fixed

The approved-private-artwork fixture from #95 had been updated with a correct `<base>` but lacked the local Angular `main*.js` script required by #49. As a result, naïvely combining the PRs would break the positive private-mode test. The consolidated fixture now includes a synthetic local JS module, and asserts that private mode rejects a missing module and an incorrect base. Synthetic-mode integration tests additionally cover an inactive CSS link, a fake link inside a comment, a missing JS module and a commented-out JS entrypoint that must not be considered executable.

## Output privacy gate (integration with draft #72 / #104)

`scripts/verify-build-privacy.mjs` and its three dedicated test suites were imported from the existing privacy-audit integration draft #104, preserving its Windows-portable path checks, rejection of credentials/source maps/local databases/symlinks, size limits, and safe error messages. The draft's additional end-to-end packaging fixture suite is included too. The existing npm commands for synthetic and approved private artwork now **only** run the privacy scan after the manifest/CSS/JS/base verifier succeeds (shell `&&`).

**Additional hardening:** the upstream privacy audit allowed any root-level `.js` or `.css` file. This could inadvertently package an unrelated `debug.js` or `diagnostics.css`. The integrated candidate now permits root code files only with the expected Angular patterns: `main*.js`, `polyfills*.js`, hashed `chunk-*.js`, and `styles*.css`. Four authored repository tests exercise rejected stray root files plus allowed generated chunk and polyfills entries. This intentionally conservative rule may require documented review when Angular changes its output names.

On Node.js 22.16.0, **19/19 independent synthetic privacy smoke cases passed** against a byte-identical local copy of the newly committed `verify-build-privacy.mjs` (blob `b76a3f57d963013dc2f5f7977ef65e255937be2f`). The cases include original privacy-safety behaviors, Windows path restrictions, root-code rejection and allowed split chunks. These 19 cases were run separately from the repository test suite; the added repository tests and full combined tests still need execution on an authorized checkout.

### Browser output encoding gate (follow-up)

The approved root JavaScript, CSS and HTML files are now decoded with fatal UTF-8 validation before packaging; malformed byte sequences and embedded NUL characters fail closed without exposing filesystem paths. Legitimate accented IT/EN strings remain accepted. This hardening is exercised by `tests/verify-build-privacy-utf8.test.mjs` (**8/8 PASS**) and the pre-existing local privacy smoke fixture (**27/27 PASS**), **35/35 combined** on Node.js 22.16.0. This is not a full Angular/Tauri build or a source-code secret scanner.

Source SHA: `4158bb9124ff0f815b6389e5cee21a2fd4a2ebb0`; committed 8-case test SHA: `144c0accdc1145cd80534ec82777f50550a7cee9`. The local smoke and exact-source hash checks were run; the full project `npm test` is still pending.

## Checks actually executed

- Node.js **v22.16.0**: `node --check` on the exact source files copied from the upstream GitHub commits for the base and JS helpers: **both pass**.
- Node.js **v22.16.0**: **37/37 passing isolated helper scenarios** against byte-identical copies of the current integrated base and JavaScript modules, including a synthetic HTML base + local JS combination, comment-only fake scripts and inert template/textarea/attribute cases. The executed local Git blob IDs match the integrated committed modules:
  - `verify-document-base.mjs`: `eec569b6a8588b2ed14ee9aa4bfdb4a3f2f95af3`
  - `verify-bundled-scripts.mjs`: `61448a5df32ecba846388f7a0adb970c031ae992`
- Read-only **17/17 static integration assertions** on the actual GitHub branch confirm the three imports and calls, their execution order, the return fields, the asset hash check, both test fixtures and negative regression coverage.
- The CSS verifier is reused **unchanged** from draft #86, whose 31 standalone synthetic cases were previously executed there. The JavaScript verifier inherited from #49 was additionally hardened after reproducing a real false-pass: it treated a `<script>` found solely in an HTML comment as an active module. Nine new authored regression tests cover inert script contexts, benign quoted metadata, actual handlers and malformed comments. They have **not** been rerun as part of this consolidation.

**Not executed:** the complete repository `npm test` (including the integrated `tests/verify-offline-bundle.test.mjs` and `tests/private-assets.test.mjs`), Angular builds using the sibling renderer, real private-artwork bundle preparation, Rust/Tauri build, Windows native UI/WebView2/CSP/network inspection. The 31-case helper smoke does **not** prove an integrated native build works. The expanded committed Node suite (23 JS module cases plus the document-base, CSS, and end-to-end bundle cases) still requires a full checkout run.

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
