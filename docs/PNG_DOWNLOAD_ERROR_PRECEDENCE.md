# PNG download: preserve the primary error during cleanup

**Status:** Prototype / locally tested helper. No Windows WebView2 or end-user PNG-save acceptance has been performed.

## Failure being addressed

The synthetic chart PNG path uses a short-lived HTML anchor. Before this patch,
`anchor.remove()` ran directly in `finally`. If setting `href`/`download`,
appending, or clicking the anchor failed and `remove()` *also* threw,
the cleanup exception replaced the primary failure. In embedded WebViews,
this obscures the operation that actually failed and can complicate debugging.

## Contract

`requestSyntheticPngDownload` now:

1. Creates one anchor; creation failure does not attempt cleanup.
2. Sets the already-validated local PNG data URL and synthetic filename,
   then appends and clicks the anchor in that order.
3. Attempts removal exactly once after an anchor has been created.
4. Preserves the **original operation error** if both operation and
   cleanup fail; cleanup-only failures still propagate to the caller.
5. Keeps browser exceptions out of the visible UI through the caller's
   existing generic error handler. It does **not** retry downloads,
   silently infer a saved file, or guarantee cleanup if the DOM refuses removal.

The helper is synchronous and introduces no network calls, native IPC,
new permissions, dependencies, persisted data, production changes or user records.
PNG validation remains the separate `png-export-safety.ts` boundary.

## Focused checks performed

In an isolated Linux mirror using source and test files byte-identical to the
GitHub branch (confirmed with `git hash-object`):

```sh
node --experimental-strip-types --test tests/png-download.test.mjs tests/png-download-error-precedence.test.mjs
# 14 passed, 0 failed, 0 skipped

node --check tests/png-download-error-precedence.test.mjs
tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/png-download.ts
# pass
```

Tool versions: Node.js 22.16.0, TypeScript 5.8.3.
Git blobs verified against the branch: helper
`8181af32badef811801b9ff038c9619269ed5bdf`, original test
`745f2e7482c7050dc2827b01a9eff8f2c359ffa4`,
new test `7dc84cb754a791f16898866b7ecbe8b9effd99f4`.

**Not performed:** full repository `npm test`, Angular/Charts build,
Tauri/Cargo checks or Windows 11 WebView2 PNG export. The isolated
mirror is not a complete checkout and is not evidence of native acceptance.

## Before review/merge

Run `npm test`, `npm run build:ui`, and synthetic export in Windows
WebView2 with successful download, blocked download, and DOM failures.
Check related open export-recovery drafts to avoid contradictory status
messaging. Keep the PR in draft until full gates and maintainer review.
Do not merge to main, publish assets, install an updater, or deploy.
