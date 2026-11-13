# Windows Angular component-style bundle gate

**Status:** static artifact protection; **not** a successful WebView2 visual acceptance test.

## Why

The original Windows GUI smoke observed a synthetic astrology wheel and native runtime
status but an almost completely unstyled UI. The existing offline verifier catches a
missing or disabled **global** `styles*.css` link, but Angular may compile the
Desktop component's CSS into a JavaScript chunk. A valid global stylesheet alone does
not guarantee the grid panels and chart stage were compiled.

## Implementation

- `scripts/verify-component-styles.mjs` inspects only local Angular-generated
  `main*.js`, `polyfills*.js`, `chunk-*.js` and `styles*.css`.
- It requires the real `.workspace` grid columns rule and `.chart-stage`
  grid/flex rule to be present in **one** candidate, accepting Angular's
  `[_ngcontent-%COMP%]` selector decoration. Mere template class names
  cannot satisfy the gate.
- It scans **every** compiled CSS/JS candidate for explicit overrides on those
  two layout elements (`display:block/none/flex`, `visibility:hidden`,
  `opacity:0`), including nested breakpoint rules and simple `:where()`/
  `:is()` selectors. A valid style in an early module cannot hide a later
  conflicting rule; child elements deliberately hidden in the collapsed
  navigation remain valid. This is a conservative static regex check, **not**
  a full CSS cascade, Angular injection or computed-style proof.
- Candidate names, regular-file/symlink constraints and file/total byte limits
  guard against unbounded reads. **All candidates are preflighted before any
  matching CSS is accepted**: an early valid `main*.js` cannot mask an unsafe
  later chunk or oversized file. The gate never follows remote URLs.
- The actual `verify-offline-bundle.mjs` CLI now invokes this check after
  base, CSS, JavaScript graph and asset verification. Both normal and optional
  private bundle checks use the CLI. The exported `verifyOfflineBundle()`
  continues to permit minimal synthetic fixtures and is not a replacement for
  running the full CLI.
- Tests cover the source rules, synthetic Angular JS and CSS output, absent or
  incomplete rules, split evidence, unsafe symlinks, oversized files, unsafe layout overrides and CLI
  wiring. No dependencies or native permissions are added.

## Verification

Run the public synthetic source workflow using the sibling public Charts checkout:

```powershell
npm.cmd test
npm.cmd run build:ui
node scripts/verify-component-styles.mjs
```

The standalone check can also inspect an existing `dist/desktop/browser` output.
Do **not** use it as evidence that Windows WebView2 actually loaded the style:
a browser can reject or fail to apply CSS despite bytes being present. Test the
real `.exe` offline with no dev server, check CSP diagnostics, and verify
sidebar, inspector, centered chart, both themes and minimum supported window
sizes in WebView2. A full Windows/Rust/Tauri/Angular acceptance test is still
pending. Preserve the current CSP; do not add a network stylesheet fallback.

No production accounts, birth data, original artwork, city catalog, releases,
repository visibility changes, GitHub Actions or main merges are part of this gate.
