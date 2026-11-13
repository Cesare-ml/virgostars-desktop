# Desktop offline packaging gates — integration draft

Status: **Prototype integration; source checks complete; combined test suite and native build not yet validated**.

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

Imported code and tests from #49, #72 and #86 are byte-identical to their source draft branches at integration time (Git blob SHA checks). They have **not** been rewritten or silently simplified during this composition. The integration changes are limited to the orchestration, `package.json` scripts, and synthetic/private fixture tests.

## Verification actually completed

- `node --test tests/document-base.test.mjs`: **18/18 PASS** with Node 22.16.0, on a local copy with Git blob SHA parity with #95's head. The same base verifier and tests are inherited here.
- GitHub Git blob identities: all 3 imported verifier modules and all 5 imported test files match their respective source draft branches exactly.
- GitHub diff and package configuration inspected. No Actions or deployment were triggered.

**NOT executed for this combined branch:** complete `npm test`, combined offline and privacy integration test, Angular `npm run build:ui`, private artwork pipeline, Tauri/Rust/Windows compilation, WebView2 runtime checks. Individual source PRs document prior isolated Node tests; those results **do not certify this assembled pipeline**.

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
