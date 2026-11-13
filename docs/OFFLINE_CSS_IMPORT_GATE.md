# Offline CSS import gate

**Status:** build-artifact safeguard, locally tested against synthetic fixtures.
Not a Windows WebView2 / full Angular build acceptance result.

## Why

The existing Desktop CSS gate checked that `index.html` references a real,
active `styles*.css` file containing the expected desktop selectors. It did
**not** check whether the stylesheet contains further `@import` rules.
An Angular desktop bundle can therefore appear to have working local CSS while
depending on another CSS file or remote stylesheet that is missing when the
application starts without Internet access.

Angular's build must inline CSS imports before Desktop packages the browser
output. Any **active `@import`** remaining in the generated global stylesheet
is treated as a packaging error, regardless of whether its target is a local or
remote URL. Do not weaken CSP or attempt a network fallback.

## Implementation

- `scripts/verify-css-imports.mjs`: `assertNoCssImports(css)` scans the
  generated CSS string and rejects real `@import` tokens, including mixed-case
  and CSS-escaped spellings. Comments, quoted strings and inert `url(...)`
  contents cannot masquerade as at-rules. Unterminated comments/strings/URLs
  fail closed.
- `scripts/verify-bundled-css.mjs`: invokes the new check **after reading**
  each approved local `styles*.css` file, before accepting required selectors.
  This existing verifier is already invoked from the normal offline bundle
  checks and `npm run verify:css`; no build script or dependency change.
- `tests/verify-css-imports.test.mjs`: 12 isolated parser tests.
- `tests/verify-css-imports-bundle.test.mjs`: 4 positive/negative
  integration tests invoking the **actual existing CSS verifier** on generated
  local HTML and stylesheet fixtures.

## Reproducible verification performed

With Node.js **22.16.0** and byte-identical files retrieved from the draft
branch, executed:

```sh
node --check scripts/verify-css-imports.mjs
node --check scripts/verify-bundled-css.mjs
node --test tests/verify-css-imports.test.mjs tests/verify-css-imports-bundle.test.mjs
```

**16/16 PASS**, zero failures or skipped cases. Git blob identity was checked
against the actual GitHub files:

- New helper: `116cf963bc2dcd54f023932ae033b412e5cb7b32`
- New helper tests: `d8fd45741cb0ccf4d23d550706c41c1fa90cb20c`
- Integrated CSS gate: `8721d2310cabec4fb05d22e235dd3edd354e7375`
- Integration fixture tests: `cd4cc7d454ed39a21ac0ece18cc3501cc83d84e4`

The synthetic fixtures contain no original artwork, records, tokens or live
services.

## Important limitations and release checks

This is a narrow generated-CSS verifier, **not a full CSS security parser**.
It specifically prevents un-inlined `@import` in the global stylesheet.
It does not validate `url(...)` dependencies, component-injected styles
inside JavaScript, imported fonts, WebView2 actual requests, or the complete
Angular chunk graph being developed separately in draft PR #111.

**NOT executed:** complete repository `npm test`, real Angular
`npm run build:ui`, approved private-artwork packaging, Rust/Tauri build,
Windows WebView2 CSS/rendering/CSP/offline inspection, and installer acceptance.
The integrated 16 synthetic tests are not proof that an actual Windows binary
has loaded CSS correctly. Keep this draft for review and run those gates on
an authorized full checkout before merging.

No modifications to UI design, native IPC, user data, astronomy, backend,
licenses, dependency versions, GitHub Actions, production or releases.
