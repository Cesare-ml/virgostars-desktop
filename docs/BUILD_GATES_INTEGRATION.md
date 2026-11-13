# Desktop offline packaging gates — integration draft

Status: **Prototype integration; 75 selected isolated Node tests and repeatable npm CLI packaging checks passed; full Angular/Tauri/Windows build not yet validated**.

This branch is **stacked on draft PR #95**, not on `main`. It assembles the independent build-artifact checks without duplicating astronomy, native IPC, auth or synchronization.

## What is integrated

| Gate | Source draft | Failure prevented |
| --- | --- | --- |
| Angular document `<base href="/">` | #95 | Wrong origin, absent or inert base, incorrect resource resolution |
| Active local stylesheets | #86 | Disabled, alternate, missing or CSP-blocked CSS; malformed links |
| Local JS entry modules | #49 | Missing, duplicated, inline or external executable scripts |
| Synthetic/private image hashes | Existing main/PR #95 | Missing, tampered, extra or unapproved image assets |
| Browser output allowlist/privacy | #72 | Debug files, source maps, unsafe names and unexpected bundled files |

The first four checks execute within `verifyOfflineBundle`. For both synthetic and approved private-artwork builds, `npm run verify:bundle` and `npm run verify:bundle:private` **also invoke** `npm run verify:privacy` after the bundle verifier succeeds. The `build:ui` scripts inherit these checks; no Windows installer or production deploy is performed.

The combined fixture tests use only synthetic image bytes and generated HTML/CSS/JS. The existing private-artwork test fixture has been updated with the required local JavaScript main module, so a valid private bundle is not incorrectly rejected.

## Exact source provenance

On initial integration, all three imported verifiers and five test files matched their source drafts exactly (8/8 Git blob comparisons). Following regression testing, **the JavaScript verifier from #49 is intentionally hardened** to parse live HTML script tags and real attributes; it is no longer byte-identical to the original #49. The CSS and privacy verifiers and the five original imported test files retain their original blob SHAs (7/8 unchanged). The new JavaScript revision and additional tests have independently checked Git blob SHAs.

## Verification actually completed — 13 November 2026

A minimal local checkout was constructed with the **exact GitHub blob bytes** of
the HTML base, CSS, JS, asset-manifest and privacy verifiers, `package.json`,
the Angular/Tauri configuration, and these five selected tests:

- `tests/document-base.test.mjs`: **18/18 PASS**
- `tests/desktop-packaging-integration.test.mjs`: **6/6 PASS**
- `tests/verify-offline-bundle.test.mjs`: **18/18 PASS**
- `tests/private-assets.test.mjs`: **4/4 PASS**
- `tests/packaging-npm-contract.test.mjs`: **3/3 PASS**
- `tests/verify-bundled-scripts.test.mjs`: **14/14 PASS** (original #49 suite)
- `tests/verify-script-tag-structure.test.mjs`: **12/12 PASS** (new regressions)

Combined: **75 tests passed, 0 failed, 0 skipped**, Node.js **22.16.0**.
Every file used for the selected tests matched its GitHub content SHA; the
new `packaging-npm-contract.test.mjs` was committed only after its local
test passed and the SHA was independently checked on GitHub.

A synthetic, entirely local browser bundle was created inside that isolated
checkout. The **actual npm script entrypoints** were run:

- `npm run verify:bundle` — **PASS** (1 image hash, 1 CSS, 1 JS and
  the chained privacy audit inspecting 4 files).
- `npm run verify:css` — **PASS** (local CSS present and active).
- Added a synthetic `debug.json` to the bundle and reran
  `npm run verify:bundle` — **expected rejection** with
  `DESKTOP BUILD PRIVACY: unapproved browser bundle file`;
  exit code 1. Test files were removed after the check.

The hardened JavaScript module now rejects script-looking references inside HTML
comments, template/noscript wrappers and malformed comments, while correctly
accepting a harmless quoted greater-than sign or onload= metadata text.
All 14 original JavaScript verifier tests still pass; 12 dedicated regressions
and two combined bundle regressions cover the new behavior. Git blob SHA parity:
JS module `bb35c4b194e1f9bc7dbad777f16ee9869bc09b3d`, new structure tests
`f20a55eec74e8c421d0013c9a9b2c1a07e7b2072`, combined bundle tests
`d112505cdc62abb0b2bb2d52fb89fa7d77e18a64`.

The actual `npm run verify:bundle` command was rerun with the hardened module:
valid synthetic bundle **exit 0**, script-only-in-comment **exit 1** with
`DESKTOP JS BUNDLE: Missing or unclosed Angular script element`, benign quoted
metadata **exit 0** with the chained privacy check. These checks confirm that
the composed verification **works on synthetic fixtures**;
the result is not a completed `npm test` from a full repository checkout.

**Still NOT tested:** the complete repository test suite, real Angular
`npm run build:ui` with its sibling `astrological-charts` dependency,
actual owner-approved artwork packaging, Tauri/Rust native compilation,
Windows WebView2 rendering/CSP/network behavior, macOS build or installer.
The private-artwork test suite used **fictional generated asset bytes**
and a synthetic injected manifest, not real artwork.

Before marking ready for review, run locally in an authorized workspace:

```powershell
npm.cmd test
npm.cmd run build:ui
npm.cmd run verify:css
npm.cmd run verify:bundle
# Only with an explicitly authorized private artwork pack:
npm.cmd run build:ui:private
npm.cmd run verify:bundle:private
```

Then perform a Windows 11 offline native smoke test: no network requests, fully styled light/dark panels, large chart, keyboard/scale checks, working local assets, and no CSP errors. Do not weaken CSP to make a failing check green.

## Integration boundaries

- This is a **stacked draft PR against #95's branch**. It must not be merged into main while the base remains draft.
- The source drafts #49, #72 and #86 remain open independently until the integration is fully validated and reconciled. Do not merge them separately on top of this combined change.
- Original artwork, private user records, secrets, backend requests, scientific calculations, license, repo visibility, updater signing and native packaging remain unchanged.
- No GitHub Actions, deploys or automatic merges.

Potential limitations: the gates are static checks and not a full HTML parser or secret scanner; symlink races and runtime resource requests require separate acceptance. Any future Angular build assets (e.g. WASM or fonts) need an explicit audited allowlist update with regression tests, not a disabled gate.
