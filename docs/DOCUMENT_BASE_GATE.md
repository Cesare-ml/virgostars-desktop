# Embedded Angular document base gate

Status: **Prototype, isolated Node tests passed. Not a native WebView2 acceptance test.**

## Problem

A CSS file can be present in `dist/desktop/browser`, pass the local stylesheet
check, and still resolve through the wrong URL if the generated HTML contains
a missing, duplicated, remote, or misplaced `<base href>` tag.

The canonical Desktop Angular source already uses `<base href="/">`.
This change enforces that convention in the generated offline bundle, rather
than modifying the UI, CSP, CSS, or Tauri asset protocol.

## Implementation

`scripts/verify-document-base.mjs` exports `verifyDesktopBaseHref(html)`,
a deliberately narrow **build-artifact validator**. It accepts exactly one
`<base href="/">` (single or double quotes, harmless whitespace) inside the
document head, before any linked stylesheet or script tag. It rejects
missing or duplicate base elements, relative or external bases, additional
unreviewed attributes, and base tags placed after asset references.

`scripts/verify-offline-bundle.mjs` now runs this check on the generated
`index.html` for **both** synthetic and approved private-artwork bundles.
Existing offline asset hashes, stylesheet checks, and external-reference
checks remain intact. A private-artwork synthetic test fixture was made
representative of the Angular-generated HTML contract.

The validator strips HTML comments before locating `<base>` and rejects any
pre-base head content except Angular's metadata tags (`<meta>` and `<title>`).
This prevents a commented-out base, a `<template>`/`<noscript>` wrapper, or
an earlier resource from masquerading as an active document base. Closed
comments that precede a real canonical base remain harmless. Unterminated
comments fail closed.

The validator is conservative and intended for generated Angular HTML, not
arbitrary web pages. It is not a complete HTML parser or a replacement for
CSP enforcement, WebView2 inspection, or security review of runtime scripts.
It does not collect birth data, add telemetry, or make network requests.

## Verification

Node.js 22.16.0:
```sh
node --check scripts/verify-document-base.mjs
node --test tests/document-base.test.mjs
```
**Actually run in an isolated checkout:** syntax check succeeded; the
expanded regression suite passed **18/18 tests** with Node.js 22.16.0.
The executed source and test match their exact current GitHub blobs:
`eec569b6a8588b2ed14ee9aa4bfdb4a3f2f95af3` and
`01883ec628ff7103a9e6ee0e0ea6ca09fca658a0`.
The extra tests cover inert/commented `<base>` tags, malformed comments,
`<template>`/`<noscript>` containment, Angular's metadata-first head and
unexpected elements preceding a base. Two additional source-contract tests
read byte-identical copies of the current committed `src/index.html`,
`angular.json`, and `src-tauri/tauri.conf.json`: they verify the canonical
base, the Angular output directory matched by Tauri `frontendDist`, the
existing `base-uri 'self'` CSP directive, and critical CSS optimization left
disabled.

Before merging, run the complete `npm test` suite and
`npm run build:ui`, `npm run verify:bundle`,
`npm run verify:bundle:private` (when an authorized private asset pack is
available), and `npm run verify:css`.
The existing bundle fixture suite now includes a missing/remote/duplicate
base rejection scenario; those integrated suites have **not been executed**
in the minimal test checkout.

A Windows Tauri/WebView2 smoke test must still establish actual load
behavior while offline. Observe the full layout, local CSS and JS
requests, 125%/150% scaling, light/dark themes and CSP diagnostics.
Neither a passing Node check nor the existence of a CSS file establishes
native visual correctness.

## Coordination and boundaries

Scope: build-only packaging guard. No new native command, user data,
astronomical calculation, sync, backend service, dependency, license,
Windows installer, deployment, GitHub Actions, or main merge.

This touches `scripts/verify-offline-bundle.mjs`, also modified by
some independently drafted build-verification PRs (for example #49).
Reconcile those changes deliberately before merging. In particular:
- **PR #49** independently verifies that the built Angular JavaScript
  entrypoint exists and is local. Both checks belong in the final
  `verifyOfflineBundle` pipeline; neither makes the other redundant.
- **PR #72** independently checks the final WebView output for unapproved
  files, Windows-incompatible names and sensitive build artifacts. Its
  package.json integration must run after the bundle verifier.
- **PR #86** supersedes the overlapping CSS-active-link safeguard from
  closed, unmerged PR #91. Prefer its quote-aware link parser when integrating
  the stylesheet check. Do not merge both implementations.

No integration between these draft branches was executed here. These are
coordination notes, not an approval to merge any of them.


## HTML meta directive guard (2026-11-14, reviewable draft)

The generated offline `index.html` must not contain `<meta http-equiv=...>`
directives. In particular, a `refresh` directive could request navigation
away from the packaged Angular page even while `<base href="/">` is correct.
The build gate now scans complete `<meta>` tags, accounting for quoted
`>` characters, **after masking closed HTML comments**. This detects
case-insensitive and unquoted `http-equiv` attributes anywhere in the
document. A future legitimate HTTP-equiv directive requires explicit review
rather than silently expanding this strict build contract.

The existing charset and viewport metadata remain permitted. The check is
called by `verifyOfflineBundle()` in both synthetic and approved-private
build modes. The gate validates a reviewed build artifact, **not general
HTML**, and is not a replacement for Tauri CSP navigation restrictions.

The focused behavioral verification evaluated the exact GitHub-committed
validator in a standalone JavaScript harness and covered seven valid/invalid
metadata scenarios. The full committed Node test runner, complete npm suite,
Angular build and native Windows WebView2 navigation smoke are still required:

```powershell
node --test tests/document-base.test.mjs
npm test
npm run build:ui
```

No new dependency, native IPC, production account, network call, private
asset, license change, GitHub Actions, source publication, release or merge
to `main` is part of this draft.
