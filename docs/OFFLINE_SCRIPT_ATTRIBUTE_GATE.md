# Offline Angular module script attribute gate

**Status:** Focused prototype hardening; Windows/WebView2 acceptance pending.

## Context

`inspectDesktopScripts` already ensures the generated Angular `index.html`
references exactly one local main module (and at most one local polyfills
module), without inline code or event handlers. Previously, extra attributes
other than event handlers were accepted without review. For example
`<script src="main-ABC123.js" type="module" async>` changes the
module-execution schedule and may race with ordered polyfills or bootstrap.
Other attributes such as `nomodule`, `integrity`, `crossorigin`, `nonce`
or `referrerpolicy` can alter load behavior and require deliberate review.

## Change

After extracting actual HTML attributes (not text from a quoted value), the
build gate permits only:

- `src`: one vetted local Angular main/polyfills filename;
- `type`: exactly `module`;
- `title`: an inert description, kept for existing verified fixtures.

All additional attributes now cause the fixed error
`DESKTOP JS BUNDLE: Unreviewed Angular script attribute`. Inline event
handlers remain rejected with their existing dedicated error. Duplicate
attributes, external URLs, missing files and inline code remain blocked.

This is a fail-closed **generated build artifact** check, not a general-purpose
HTML validator, JavaScript parser, proof of runtime ordering, CSP replacement,
or production WebView2 security audit. A future reviewed Angular output
change must update the allowlist with tests rather than bypass the gate.

## Verification

The exact new committed `scripts/verify-bundled-scripts.mjs` file was
evaluated in an isolated V8 harness using stubbed Node read/stat adapters.
**14 of 14 behavior scenarios passed**: canonical main and polyfills
references; safe title metadata; rejected async, defer, nomodule, nonce,
integrity, crossorigin, referrerpolicy, fetchpriority, data attributes,
unreviewed IDs, and async polyfills.

The complete Node test runner has **not** been executed against an authorized
full checkout. Run:

```powershell
node --test tests/verify-bundled-scripts.test.mjs
npm test
npm run build:ui
npm run verify:bundle
```

For Windows 11 QA, run a real offline Tauri/WebView2 executable and confirm
main module plus polyfills load in the expected order and CSP reports no
unexpected blocked resources. Do not weaken Tauri security to pass tests.

## Boundaries

No native IPC, Rust changes, protected city catalog, licensed artwork,
production account, secrets, network endpoint, dependency, UI layout,
CPAL attribution, GitHub Actions, release, visibility change, or
`main` merge. This is a standalone draft for maintainer review.
