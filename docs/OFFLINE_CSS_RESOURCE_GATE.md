# Offline CSS resource-function gate

**Status: Prototype build-artifact hardening.** This is not evidence that Windows WebView2 loaded CSS, that all CSS is safe, or that a native Windows build succeeded.

## Problem

The existing bundled-CSS verifier requires an active, local stylesheet and rejects CSS \`@import\`, but a compiled global stylesheet could still contain \`url(...)\` or \`image-set(...)\` resource loads. Such declarations can try to fetch missing files or remote images/fonts, making an apparently complete desktop build depend on network access. The present source global and component styles do not use these functions.

## Scope and implementation

- \`scripts/verify-css-resource-functions.mjs\` introduces \`assertNoCssResourceFunctions\`, a conservative lexical scanner. It rejects executable \`url()\`, \`image-set()\`, \`-webkit-image-set()\` and \`image()\` calls even when they point to local files, fragment IDs or embedded data URLs. This is **intentional for the current global stylesheet**; adding a future local image/font requires a reviewed asset URL allowlist, manifest check and license clearance instead of silently loosening this rule.
- Mixed case, CSS hex escapes and whitespace/comments between a function name and \`(\` cannot bypass the check. Quoted text and CSS comments stay inert. Malformed comments, strings and identifier escapes fail closed.
- \`scripts/verify-bundled-css.mjs\` now calls this helper after the existing \`@import\` guard and before accepting the expected Desktop selectors. Thus it runs through existing \`npm run verify:css\`, \`npm run verify:bundle\`, and \`npm run verify:bundle:private\`. No npm script, dependency or CSP change is necessary.
- \`tests/verify-css-resource-functions.test.mjs\` covers lexical positive/negative cases and synthetic bundle fixtures invoking the real CSS verifier. All fixtures are fictional; no actual downloads or private artwork.

## Verified and outstanding

**Executed with Node.js 22.16.0 on a byte-identical local helper and its first seven focused test cases:**

\`\`\`text
node --test tests/verify-css-resource-functions.test.mjs
7 passed, 0 failed
\`\`\`

The above command was executed **before** adding three integration tests and the import of the existing bundled-CSS helper; those three repository integration cases were authored but not executed with a full checkout. The separately tested new helper blob was \`1b5270f2d62a8632f3b07bec7cd5b958516261c1\`; the initial seven-case test blob was \`47f19ca682af802dac02e080d545d8a268489643\`. The repository's final integrated verifier and expanded test source still require the full \`npm test\` gate.

Before considering integration, run \`npm test\`, \`npm run build:ui\`, and \`npm run verify:css\` with the approved local Charts package; repeat for approved private artwork when permitted. On the target Windows host, confirm the stylesheet is actually applied in WebView2, the chart fills its intended stage, the console shows no CSP/network errors, and the app works without a development server or Internet. An offline file check cannot verify those runtime facts.

## Limitations and safety

This gate inspects **only linked global generated CSS**, not Angular component styles embedded in JavaScript, inline styles inserted at runtime, WebView2 requests, DOM/CSSOM behavior, external JavaScript or image metadata. It is a conservative syntax gate, not a complete standards-compliant CSS parser or a full offline resource graph. Existing JavaScript graph, image manifest, privacy and Tauri security checks remain independently required.

No real birth records, auth, local encrypted storage, backend sync, astronomical calculations, network clients, production infrastructure, licenses, CI automation, release artifacts or repository visibility are touched.
