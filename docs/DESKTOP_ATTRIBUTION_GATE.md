# Desktop CPAL attribution source gate

**Scope:** a dependency-free, fail-closed **source preflight** for the original VirgoStars Desktop attribution. This does not license, redistribute or inspect third-party data or materials.

`node scripts/verify-desktop-attribution.mjs` checks that:

- the Angular Desktop template has exactly one static `<footer>` directly under the unconditionally present `<main class="chart-panel">`; a footer in an HTML comment, inert `<template>`/`ng-template`/`noscript` or nested container does not qualify;
- its static `copyright-attribution` span matches the **complete** expected copyright, `Powered by VirgoStars` phrase and `https://www.virgostars.it/` URL (no interpolation or extra content); a hidden or conditional ancestor invalidates the check;
- the checked-in `NOTICE` contains the matching developer, phrase and URL;
- CPAL-1.0 `LICENSE` Exhibit B still defines that same copyright notice, phrase and URL.

`npm run verify:attribution` runs the gate separately; both `verify:bundle` and `verify:bundle:private` run it before completing an offline frontend build. The standard `npm test` discovers its synthetic regression tests. This gate is intentionally strict about the simple current template structure: changes to the footer should be consciously reviewed, not silently exempted.

## Limitations and manual acceptance

This validates **source strings and location**, not the compiled JavaScript, real DOM, responsive visibility, contrast, clipped layouts, launch notices in multiple windows, or full CPAL compliance. It cannot detect every way CSS or runtime logic might hide the footer. Before any source publication or Windows release, visually inspect the actual WebView2 launch/session attribution at representative display sizes and scaling and complete `docs/PUBLICATION_CHECKLIST.md`. The private city-catalog release-asset blocker still applies; passing this gate does **not** approve repository publication or an installer.

Run from the repository root:

```powershell
node --test tests/desktop-attribution.test.mjs
npm run verify:attribution
npm test
npm run build:ui
```

No credentials, account access, production services, external URLs, network operations or GitHub Actions are used by this verifier. This changes no astronomical calculation, synchronization, native permission or build dependency.
