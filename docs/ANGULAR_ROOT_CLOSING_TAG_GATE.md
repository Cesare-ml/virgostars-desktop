# Angular Desktop root closing-tag integrity

**Status:** static build-artifact hardening, tested in isolation; no native acceptance.

## Problem

The offline bundle gate requires an empty `<vs-desktop-app></vs-desktop-app>`
as the first real child of the generated HTML `<body>`. Its existing check
already rejected duplicate opening tags, missing roots and fake commented roots.
However, a well-formed prefix followed by an **extra closing root tag** could
still pass because only the opening tag was counted.

## Change

`scripts/verify-desktop-app-root.mjs` now requires **exactly one live closing
`</vs-desktop-app>` tag** in the generated document. Comments are masked
before counting, so a harmless commented example does not cause rejection.
The canonical Angular `src/index.html` is accepted unchanged.

The validator intentionally remains a narrow, fail-closed contract for the
generated VirgoStars Desktop entrypoint. It is not a general-purpose HTML
parser and does not prove Windows WebView2 runtime behavior.

## Verification

With **Node.js 22.16.0**, an isolated checkout containing the byte-identical
GitHub verifier/test files and the canonical tracked `src/index.html` ran:

```sh
node --test tests/desktop-app-root.test.mjs
```

**16/16 PASS, 0 failed, 0 skipped.** The source and test files in the
isolated run matched the committed Git blob hashes:

- Verifier: `7446bb0caf66e4f5ab36d9ba67366bf3f1c9aa78`
- Test suite: `fb74beb43d75da3d782a64aa238360c396945a0f`
- Canonical HTML: `a74eb3f05e374f539a1eba5471ea06783b972e51`

The test suite covers a real root, comments, uppercase markup, absent or
duplicated roots, unexpected attributes, mismatched body elements,
a closing-tag duplicate after the actual root, an extra closing tag outside
the body, and a commented-out closing tag.

## Integration/acceptance

PR #105 was merged into `main` while this correction was under review
(merge commit `6e96f3e8137dcacd88dc86f1bca00ca12f948d95`). This change
now targets **`main` directly** in an independent draft PR. It was **not**
part of the #105 merge and does not overlap with independent JavaScript
chunk-graph work in #111.

**Not run:** full-repository `npm test`, real Angular `npm run build:ui`,
approved private-artwork packaging, native Rust/Tauri compilation, Windows
WebView2 CSS/JS/CSP/network inspection, release or deployment.

Do not merge this draft before reviewing its regression evidence and
rerunning the complete Windows acceptance path. No
GitHub Actions, license changes, secrets or production changes.
