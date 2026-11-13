# Active stylesheet packaging gate

Status: **Prototype — local synthetic Node test evidence**, not a native WebView2 rendering test.

## Why this exists

The offline Angular bundle already verifies that a local `styles*.css` file is
linked from `index.html`, is an ordinary file, and contains global Desktop
CSS markers. The Windows critical-CSS fix separately rejects deferred
`media="print"` plus inline `onload`, which is blocked by the restrictive
Tauri Content Security Policy.

That check still accepted a link that referenced a valid CSS file but
**would not be applied as a normal active stylesheet**, such as a disabled
link, `rel="alternate stylesheet"`, or an invalid stylesheet MIME type.
Such output can pass a filesystem check while displaying an unstyled UI.

## New bundle verification

`scripts/verify-bundled-css.mjs` now fails closed when any linked desktop
stylesheet includes:

- A `disabled` HTML attribute, with or without a value.
- An `alternate` token in the `rel` attribute.
- A `type` attribute other than `text/css` (case insensitive).

Normal local `rel="stylesheet"` links remain accepted, including optional
`type="text/css"` and `media="screen"` settings. Existing restrictions on
local safe names, symlinks, print-only media, inline event handlers, and
required CSS markers are unchanged.

The check operates on **build artifacts**, not DOM state after JavaScript
runs. It cannot guarantee WebView2 applied the CSS, prove valid
component-scoped styling, or detect an externally modified native installer.

## Verification and acceptance

The new synthetic suite uses only temporary directories and generated CSS;
it never reads a private user profile or a real browser history.

```sh
node --test tests/css-active-link.test.mjs
npm test
npm run build:ui
npm run verify:css
```

An isolated Node.js 22.16.0 execution of the new six-test suite passed.
Full repository tests, Angular build with the sibling Charts package,
Tauri/Cargo build, and native Windows/macOS checks **were not run** in that
isolated test environment.

Before integration: build the current Windows bundle, inspect the generated
index for ordinary active local CSS links, launch the resulting executable
offline, and verify light/dark shell appearance, large centered chart,
inspector/sidebar behavior and browser-console CSP errors. Do not weaken CSP
to compensate for style-loading failures.

## Coordination

This incremental guard builds on the existing Windows CSS fix in main and
does not replace the earlier CSS diagnostic/critical-CSS draft work.
Review overlap with PR #18 before merging its stacked changes. No account
data, backend changes, license choice, GitHub Actions, public release, or
deployment is involved.
