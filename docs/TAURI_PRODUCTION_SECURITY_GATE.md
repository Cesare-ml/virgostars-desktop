# Tauri production and development WebView security configuration gate

**Status:** synthetic-source build safeguard; no native runtime or release certification.

## Why

The offline Angular bundle can pass CSS, JavaScript and asset checks while the Tauri host points a native window to an external URL, relaxes its production Content Security Policy (CSP), enables additional native capabilities, or activates installer packaging before review. This dependency-free preflight pins the narrow existing production configuration and fails closed if the reviewed surface changes.

## Enforcement

Run:

    node scripts/verify-tauri-security-config.mjs

The command also runs during **both** npm `verify:bundle` / `build:ui` and `verify:bundle:private` / `build:ui:private` paths, **and before `npm run tauri:dev` starts the native development host**. Its tests run with `npm test`. Standalone manual Tauri CLI invocations bypass npm script guards, so use the documented commands.

The gate requires:

- The Tauri root keys must match the reviewed schema, product name and application identifier, with no unreviewed global options or plugins. The `build` section permits only `devUrl` and `frontendDist`.
- The `bundle` section permits only `active` and the existing three local platform icons, in their reviewed order. Extra resources, external binaries, new packaging knobs or alternate icons require review.
- The packaged frontend stays at the local `../dist/desktop/browser` path, without an unreviewed Tauri `beforeBuildCommand`.
- Exactly **one** local native window must retain the reviewed six fields (`label`, `title`, `width`, `height`, `minWidth`, `minHeight`). Unknown or missing keys and extra windows fail the gate. In particular, `additionalBrowserArgs`, `devtools`, `webviewDataDirectory`, and explicit external `url` settings cannot be slipped into the Tauri config without review.
- Production CSP contains the existing nine directives and their exact allowed source lists; no extra, missing or duplicate directives, remote URLs, `unsafe-eval`, or script `data:` sources are accepted.
- The native capability list stays empty, the global Tauri bridge stays disabled, asset CSP rewriting is not explicitly disabled, and an unreviewed asset protocol is absent.
- `bundle.active` remains false. A signed installer is a separate release task requiring review and authorization.
- The development URL remains `http://127.0.0.1:4200`, without a new `beforeDevCommand` startup hook. The development CSP keeps only the reviewed `127.0.0.1:4177` preview asset origin and `ws://127.0.0.1:4200` live-reload socket in addition to the local WebView origin; changes to these allowances require review.

The production CSP intentionally retains `style-src 'unsafe-inline'` for the currently reviewed Angular/Tauri styling approach; its presence is **not** a blanket security guarantee. The development-only `devCsp` allows the specifically reviewed local preview/HMR origins, but **never an arbitrary remote host**. It deliberately permits `'unsafe-eval'` only in development and must never be substituted for the production CSP. This gate now checks both policies independently.

## Limits and change process

This is a **static source configuration audit of packaged and development settings**, not a CSP runtime test, proof that development requests are local, full secret scanner, permission proof, asset provenance verification, or signed-binary verification. The Tauri development preflight blocks unreviewed source configuration only when launched via the documented npm script; it cannot restrict arbitrary commands an authorized developer runs directly. Other build gates still handle implicit Tauri capability files, native IPC review, bundle completeness, private assets and Windows PE validation. Dynamic Rust windows, dependency behavior, WebView2 policy delivery and actual offline operation still need native QA.

To add a legitimate new production source, capability, asset protocol, build hook or installer: update the explicit allowlist **in a separate reviewed change**, add focused negative tests and document the security justification. Do not bypass the gate to unblock a build. Do not change production, user data, repository visibility, updates or releases from this check.

## Native window option allowlist (2026-11-14)

The earlier check rejected explicit `url` keys but permitted additional Tauri
window options. Some options can influence native WebView behavior independently
of the inspected CSP. The synthetic preflight now requires the exact **keyset**
of the reviewed single window, not specific display dimensions or labels. Any
legitimate additional window, WebView option or renamed field requires an
explicit security review and a matching test update before packaging. This
is a static config check: it does not examine windows created dynamically by
Rust code or certify the WebView2 runtime. Run
`node --test tests/tauri-security-config.test.mjs`, followed by `npm test`
and the Windows native smoke checklist. No installer, new permissions, production
systems or user data are involved.


## Reviewed app and security option inventory (2026-11-14)

The packaged and development Tauri config must use only `app.windows` and `app.security`; the security object must contain only `capabilities`, `csp`, and `devCsp`. Unknown options, including explicit `false` flags, are blocked for review. This complements the independently reviewed single-window keyset and preserves the existing production/development CSP and local-only build protections. Adding a legitimate new option requires a documented allowlist update, a negative test, and a native Windows review. The gate is static; it does not attest dynamically created Rust windows or runtime CSP enforcement.

## Tauri source packaging inventory (2026-11-14)

The source preflight now uses an explicit key inventory for the Tauri root,
`build`, and `bundle` objects, in addition to the independently reviewed
`app`, native window and security/CSP checks. The reviewed root schema is
`https://schema.tauri.app/config/2`, the product name is `VirgoStars Desktop Lab`,
and the application identifier remains `it.virgostars.desktop.rendererlab`.
The three approved icon references are `icons/icon.png`, `icons/icon.ico`, and `icons/icon.icns`. These existing files support the reviewed platform bundles; alternate filenames or order still fail closed.
The app version is checked by the existing dedicated version-consistency gate.

An attempt to add a Tauri plugin, build watch-folder, bundled resource,
sidecar executable, icon or other unknown field must be deliberately reviewed
before relaxing this allowlist. The existing `bundle.active=false` boundary
remains in force. This is **configuration-source validation**, not a dependency,
icon-content, asset-ownership, release-signature or native runtime audit.
Use the existing `verify:bundle` and `tauri:dev` checks plus the documented
Windows smoke acceptance before treating any build as suitable for distribution.
