# Desktop offline bundle — single active global stylesheet

**Status:** prototype packaging hardening; real Windows WebView2 visual acceptance pending.

## Problem

The generated Angular desktop `index.html` is expected to link one active
global stylesheet. Previously `inspectDesktopStyles` accepted any positive
number of separately valid local `rel="stylesheet"` links. Duplicate or
second hashed CSS files may change the cascade order, cause unexpected style
overrides, or mask accidental build configuration drift while still passing
all per-file checks. This is particularly relevant while investigating
Windows WebView2 builds with apparently missing CSS.

## Contract

The offline CSS packaging verifier now requires **exactly one** active global
stylesheet link in the generated HTML:

- Zero links continue to fail with the existing "no linked stylesheet" error.
- Two or more links with the `stylesheet` relation now fail closed even when
  each points to the same valid local file or a different approved-looking
  local CSS filename.
- A `<link rel="preload" as="style">` without `stylesheet` remains outside
  this count. It does not establish that any stylesheet has actually loaded.
- Stylesheet-shaped strings inside comments or inert HTML do not count.
- All pre-existing checks remain in place: local filename, regular file,
  enabled/active media, MIME, no unsafe CSS imports, and expected global
  selectors. No CSP weakening or runtime injection is introduced.

This is deliberately specific to the **current Angular desktop build**
and is not a general CSS or HTML rule. If future Angular output legitimately
needs more than one global stylesheet, explicitly review and update the
packaging contract together with tests. The change does not control inlined
component styles or replace the separate compiled component-style audit.

## Verification

The exact GitHub-committed `scripts/verify-bundled-css.mjs` code was evaluated
in an isolated V8 harness with injected in-memory filesystem adapters.
**9/9 scenarios passed**, including single CSS, duplicate identical CSS,
two different CSS filenames, commented-out duplicate, preload+CSS,
missing CSS, disabled CSS, quoted greater-than metadata, and quoted
non-attribute text. The checked-in regression test file adds four focused
`node:test` groups for the two duplicate cases and the two permitted cases.

The full `node --test` runner against this GitHub checkout was **not
executed** in this environment. Reviewers should run:

```powershell
node --test tests/verify-css-enabled-links.test.mjs
npm test
npm run build:ui
npm run verify:css
npm run verify:bundle
```

Use the approved Windows 11 build workflow to visually check WebView2
layout/CSS on 100%, 125% and 150% display scaling, with network disabled.
The source check **does not prove** that Windows actually loaded the CSS.

## Boundaries and integration

`verifyOfflineBundle()` already calls `inspectDesktopStyles()`, so the
new count gate applies to synthetic and approved-private packaging paths
when run. Review in the context of concurrent CSS/component-build
verification PRs; do not merge without full validation.

No GitHub Actions, production data, protected city files, external artwork,
native IPC, ephemeris, sync, package dependency, license/NOTICE change,
release, executable publishing, repository visibility change, or merge to
`main` is performed.
