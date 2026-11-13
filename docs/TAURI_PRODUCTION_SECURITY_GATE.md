# Tauri production security configuration gate

**Status:** synthetic-source build safeguard; no native runtime or release certification.

## Why

The offline Angular bundle can pass CSS, JavaScript and asset checks while the Tauri host points a native window to an external URL, relaxes its production Content Security Policy (CSP), enables additional native capabilities, or activates installer packaging before review. This dependency-free preflight pins the narrow existing production configuration and fails closed if the reviewed surface changes.

## Enforcement

Run:

    node scripts/verify-tauri-security-config.mjs

The command also runs during **both** npm `verify:bundle` / `build:ui` and `verify:bundle:private` / `build:ui:private` paths. Its tests run with `npm test`.

The gate requires:

- The packaged frontend stays at the local `../dist/desktop/browser` path, without an unreviewed Tauri `beforeBuildCommand`.
- Every configured native window uses its bundled default URL (no explicit `url`), and at least one window exists.
- Production CSP contains the existing nine directives and their exact allowed source lists; no extra, missing or duplicate directives, remote URLs, `unsafe-eval`, or script `data:` sources are accepted.
- The native capability list stays empty, the global Tauri bridge stays disabled, asset CSP rewriting is not explicitly disabled, and an unreviewed asset protocol is absent.
- `bundle.active` remains false. A signed installer is a separate release task requiring review and authorization.

The production CSP intentionally retains `style-src 'unsafe-inline'` for the currently reviewed Angular/Tauri styling approach; its presence is **not** a blanket security guarantee. The separate development-only `devCsp` includes loopback/eval allowances and is **not** audited here. It must never be used as evidence of the production policy.

## Limits and change process

This is a **static source configuration audit**, not a CSP runtime test, full secret scanner, permission proof, asset provenance verification, or signed-binary verification. Other build gates still handle implicit Tauri capability files, native IPC review, bundle completeness, private assets and Windows PE validation. Dynamic Rust windows, dependency behavior, WebView2 policy delivery and actual offline operation still need native QA.

To add a legitimate new production source, capability, asset protocol, build hook or installer: update the explicit allowlist **in a separate reviewed change**, add focused negative tests and document the security justification. Do not bypass the gate to unblock a build. Do not change production, user data, repository visibility, updates or releases from this check.
