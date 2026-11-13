# Offline JavaScript entrypoint verification

**Status:** synthetic static bundle gate. This is not a native Windows or WebView2 runtime acceptance test.

The Angular build verifier previously checked the app root, permitted images and the global CSS link but could accept a missing local JavaScript entrypoint, a script URL using a nonlocal scheme or an extra inline script. Native packaging must fail closed for these cases instead of shipping an apparently valid but broken or unsafe offline bundle.

## New gate

- `scripts/verify-bundled-scripts.mjs` inspects `dist/desktop/browser/index.html` and its root-level JavaScript module references.
- Requires **exactly one** `main[-hash].js` module and permits at most one `polyfills[-hash].js` module. Both must be regular local files, not symlinks.
- Rejects duplicate `src`/`type` attributes, scripts without `type="module"`, unclosed tags, inline script content and inline script event handlers.
- Rejects remote URLs, protocol-relative URLs, `data:` URLs, traversal, root-absolute paths and unapproved script filenames.
- `scripts/verify-offline-bundle.mjs` invokes this gate alongside the existing CSS and synthetic/private asset checks. The existing `npm run build:ui` and `npm run verify:bundle` commands inherit it automatically.

## Local reproducible tests

```powershell
node --test tests/verify-bundled-scripts.test.mjs tests/verify-offline-bundle.test.mjs
npm run verify:bundle
```

The isolated JavaScript module tests were run with Node.js 22.16.0: **14/14 PASS** on synthetic temporary files. The full Angular build and Windows native smoke test were **not executed** for this increment. After rebuilding on an authorized Windows checkout, check that the output entrypoint still emits the expected main/polyfills modules; investigate any unexpected filename rather than disabling the guard.

## Scope and limitations

This is a targeted static entrypoint and file-existence guard, **not** an HTML security parser, a full JS dependency graph audit, a promise of no network access, a script-integrity signature or proof that WebView2 loaded or executed scripts. Dynamic imports, module content, CSS imports, worker resources, asset rights, native IPC and OS packaging still require their separate checks. No production accounts, private data, astronomy algorithms, security policy relaxations, licensing changes or releases are involved.
