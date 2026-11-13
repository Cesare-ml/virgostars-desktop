# Offline Angular ESM chunk closure gate

**Status:** locally tested isolated Node module; complete Angular/Tauri build and Windows WebView2 acceptance still pending.

## Why this exists

The existing `verify-offline-bundle.mjs` checks that the desktop HTML includes a real local `main*.js` and optional `polyfills*.js` module. However, those files can import additional split Angular chunks. A build with a present entrypoint but a missing lazily loaded `chunk-*.js` might pass the old verifier and fail only after a user opens that feature offline.

## Implementation

- `scripts/verify-angular-chunks.mjs` exports `inspectAngularChunkGraph(bundleDir, entrypointFiles)`. It uses the **existing TypeScript devDependency** as a parser of the actual generated JavaScript; it does **not execute** compiled modules or add a runtime dependency.
- Starts from the active HTML entrypoints already validated by `inspectDesktopScripts`, and follows *literal* static imports, re-exports, dynamic `import("./chunk-*.js")`, JavaScript `new URL("./chunk-*.js", import.meta.url)` references and explicit `new Worker()`/`new SharedWorker()` local script references through all reachable root-level ESM chunks. Module-relative computed worker URLs are rejected instead of silently accepted.
- Accepts only bounded root-level Angular `main*.js`, `polyfills*.js`, `chunk-*.js` filenames; rejects missing files, symlinks, unrelated root scripts, orphan chunks, malformed JS, remote and traversal imports, and nonliteral/dynamically constructed import targets. Handles repeated/cyclic edges without an infinite loop.
- Worker and SharedWorker URLs are **always treated as executable code**, even when they have no `.js` suffix. A reproduced false pass accepted `new Worker(new URL("https://example.invalid/remote-worker", import.meta.url))` and also accepted an image path as the Worker source. Both now fail closed; unrelated legitimate image asset URLs outside Worker constructors remain out of scope.
- Bounds module count to 512, individual module size to 64 MiB and total visited JavaScript to 256 MiB. No filenames, filesystem locations, personal data or JavaScript content appear in gate error messages.
- The same graph gate runs after CSS and entrypoint validation and before the existing SHA-256 asset-manifest verification in **both** synthetic and approved private-artwork build modes.
- `verifyOfflineBundle` now returns `modules`, `chunks`, and `dependencies` aggregate counts in addition to its prior output.
- No GitHub Actions, native IPC, user records, network requests, package-install scripts or new dependencies.

## Validation completed

Node.js **22.16.0**, with the repository's existing TypeScript **5.8.3** devDependency available:

```sh
node --check scripts/verify-angular-chunks.mjs
node --test tests/verify-angular-chunks.test.mjs
```

The exact committed source and test files were executed in an isolated local checkout: **32/32 tests passed**, zero failed, zero skipped. Git blob identity matched GitHub:

- `scripts/verify-angular-chunks.mjs`: `f698f2606f357024f92514d2a1a8c7cad3d7b1f3`
- `tests/verify-angular-chunks.test.mjs`: `52264a42d8a3bf45cdeb7a604c791f5ecf444c82`

Tests cover static/dynamic/re-exported and transitive chunks, missing or orphan chunks, local Worker/SharedWorker modules, `import.meta.url` references, symlinks, cycles, invalid syntax, unsafe URLs, computed imports and redaction of inaccessible directory paths. Filesystem errors are caught and converted to fixed messages. Seven **additional authored integration tests** are included in `tests/verify-offline-bundle.test.mjs`, including worker dependencies, but are **not claimed as executed** in the complete project checkout.

## Required before merging or shipping

Run the full `npm test`, `npm run verify:bundle`, `npm run build:ui` (with the correct sibling astrological-charts distribution), and Windows Tauri/WebView2 offline smoke with all lazy-loaded UI routes. This gate cannot prove that chunks run successfully or that the chart/astronomical engine is correct.

The checker is deliberately conservative. Non-JavaScript asset URLs (e.g. a local image `new URL('./assets/img/example.png', import.meta.url)`) are not treated as chunk dependencies and remain subject to their separate asset packaging rules. If Angular's output moves modules under subdirectories, introduces arbitrary dynamic import expressions, emits new worker URL forms or new ESM naming schemes, inspect the actual build and extend the contract with tests; **never disable the guard merely to silence a build failure**.

## Coordination

PR #105 was merged into `main` by another project workflow on 13 November 2026. This feature remains an **independent draft PR #111 against `main`**. Its branch still needs a final upstream synchronization, complete test run and native acceptance before any main merge. No release or deploy is implied.
