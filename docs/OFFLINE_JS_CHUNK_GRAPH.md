# Offline Angular ESM chunk closure gate

**Status:** locally tested isolated Node module; complete Angular/Tauri build and Windows WebView2 acceptance still pending.

## Why this exists

The existing `verify-offline-bundle.mjs` checks that the desktop HTML includes a real local `main*.js` and optional `polyfills*.js` module. However, those files can import additional split Angular chunks. A build with a present entrypoint but a missing lazily loaded `chunk-*.js` might pass the old verifier and fail only after a user opens that feature offline.

## Implementation

- `scripts/verify-angular-chunks.mjs` exports `inspectAngularChunkGraph(bundleDir, entrypointFiles)`. It uses the **existing TypeScript devDependency** as a parser of the actual generated JavaScript; it does **not execute** compiled modules or add a runtime dependency.
- Starts from the active HTML entrypoints already validated by `inspectDesktopScripts`, and follows *literal* static imports, re-exports and dynamic `import("./chunk-*.js")` calls through all reachable root-level ESM chunks.
- Accepts only bounded root-level Angular `main*.js`, `polyfills*.js`, `chunk-*.js` filenames; rejects missing files, symlinks, unrelated root scripts, orphan chunks, malformed JS, remote and traversal imports, and nonliteral/dynamically constructed import targets. Handles repeated/cyclic edges without an infinite loop.
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

The exact committed source and test files were executed in an isolated local checkout: **18/18 tests passed**, zero failed, zero skipped. Git blob identity matched GitHub:

- `scripts/verify-angular-chunks.mjs`: `292af877cf0b9592b0f69766fd240cd8d49b7675`
- `tests/verify-angular-chunks.test.mjs`: `975ca04bf61e93371bdd656dd546668381e14f8e`

Tests cover static/dynamic/re-exported and transitive chunks, missing or orphan chunks, symlinks, cycles, invalid syntax, unsafe URLs, and computed imports. Three **additional authored integration tests** are included in `tests/verify-offline-bundle.test.mjs` but are **not claimed as executed** in the complete project checkout.

## Required before merging or shipping

Run the full `npm test`, `npm run verify:bundle`, `npm run build:ui` (with the correct sibling astrological-charts distribution), and Windows Tauri/WebView2 offline smoke with all lazy-loaded UI routes. This gate cannot prove that chunks run successfully or that the chart/astronomical engine is correct.

The checker is deliberately conservative. If Angular's output moves modules under subdirectories, introduces arbitrary dynamic import expressions, emits worker URLs or new ESM naming schemes, inspect the actual build and extend the contract with tests; **never disable the guard merely to silence a build failure**.

## Coordination

This is a **stacked integration candidate on draft PR #105**, not an independent main-ready change. PR #105 is itself consolidating earlier build guards. Review upstream conflicts and run the full combined test suite before any main merge. No release or deploy is implied.
