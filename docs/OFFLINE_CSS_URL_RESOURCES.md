# Offline CSS URL resource gate

**Status:** build-artifact safety check, locally tested using synthetic fixtures. It does **not** establish that Windows WebView2 loads the CSS, or that a Tauri executable builds successfully.

## Purpose

VirgoStars Desktop already checks that Angular emits an enabled local global stylesheet, and rejects remaining `@import` rules. A second problem is possible: the stylesheet itself can contain `url(https://...)` for fonts/images that will fail offline, or a local `url(media/missing.woff2)` whose file was not packaged. A valid stylesheet link does not prove these dependencies exist.

The new `scripts/verify-css-urls.mjs` checks *active* `url(...)` functions in generated global CSS, including case-insensitive and CSS-escaped function names or values. CSS comments and quoted content strings are inert. Malformed comments, strings, escapes and URLs fail closed.

## Approved resources

- Relative files in `media/<file>` (Angular-emitted hashed fonts) or `assets/img/<file>`. Each directory and file must exist within the bundle as a regular, non-symlink filesystem object. Traversal, absolute paths, encoded paths, network schemes, fragments and query strings are rejected.
- Bounded canonical Base64 `data:image/png`, `data:image/jpeg`, `data:image/gif`, or `data:image/webp` URLs. The scanner does not decode image structure, so image-content integrity remains a separate concern.
- No URL references at all (the current committed global `src/styles.css` does not require external resources).

Remote HTTPS/HTTP, protocol-relative, `blob:`, `file:`, `javascript:`, SVG data and unsupported paths are rejected. Introduce new asset-layout forms only with a documented source/build review; **do not** weaken Tauri CSP to make styles load.

## Integration and checks

`scripts/verify-bundled-css.mjs` invokes the checker after the existing CSS import check and before accepting the global stylesheet. Therefore the existing `npm run verify:css`, `npm run build:ui` and synthetic/private offline bundle verification already inherit it; the npm scripts and dependencies are unchanged.

Focused test commands:

```sh
node --check scripts/verify-css-urls.mjs
node --test tests/verify-css-urls.test.mjs tests/verify-css-urls-bundle.test.mjs
npm run verify:css
```

During development, Node.js 22.16.0 successfully executed **12 synthetic test cases** (8 pure-helper cases plus 4 cases through a local mirror of the pre-existing stylesheet inspector). The tested helper and new test files were copied unchanged to the draft branch and verified against their exact Git blob hashes. The complete connected repository was **not** checked out locally, so the integration cases were not yet executed against the exact uploaded copy of the unchanged legacy inspector. Run the commands on the full branch checkout before merge.

## Limitations

The scanner guards `url(...)` in the **linked global stylesheet** only. It is not a complete CSS parser and does not inspect `image-set("...")` string sources, CSS injected by Angular components/JavaScript, service workers, runtime requests, third-party image content, or license rights. The path checks are not a substitute for the existing asset manifest, privacy, ESM graph and Tauri production security verifiers. The checker does not contact the network, read private records, or add native permissions. Verify offline WebView2 with the network disconnected, including fonts, visuals, light/dark mode and screenshots/PNG output, before declaring the Windows GUI accepted.

No changes to astronomy, accounts, protected city data, production, release signing, license or repository visibility.
