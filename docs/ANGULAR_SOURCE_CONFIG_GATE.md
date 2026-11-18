# Angular source configuration — pre-build approval gate

**Status:** source-only, synthetic testable guard. Not proof of a safe package, native runtime or approved release.

## Problem and scope

The existing offline bundle verifiers inspect **generated files**. Angular `ng build`, however, reads `angular.json` *before* output inspection. An unreviewed addition to `scripts`, `styles`, `assets`, `fileReplacements`, builder options or the dev-server target could change what is compiled or execute unintended build inputs. The source gate makes those changes explicit review events.

`scripts/verify-angular-source-config.mjs` accepts exactly the reviewed `desktop` project and its synthetic and optional private-artwork inputs, including CSS critical-inlining disabled for the current CSP, no font network optimization and no extra build projects/options. It rejects any unknown field, altered path, new configuration or changed optimization option. It also rejects **duplicate JSON object keys**, including Unicode-escaped aliases, before comparing with the reviewed configuration. This prevents ambiguous keys from being silently collapsed by `JSON.parse`; whitespace-only formatting changes remain allowed. This is an intentionally strict equality policy rather than a general-purpose Angular config linter. The checker opens `angular.json` once as a bounded read-only file descriptor (64 KiB + 1-byte overflow guard), requests `O_NOFOLLOW` on supported platforms, compares device/inode before reading, and closes the descriptor even on failure. The synthetic file-swap/growth tests cover these rejection paths; a Windows-native behavior check remains necessary.

Both `npm run build:ui` and `npm run build:ui:private` run the read-only check **before** staging or invoking Angular. The normal Tauri build scripts depend on these UI build commands. **The development entrypoints are also guarded:** `npm start` now validates the Angular project before preparing approved local original assets and starting the private-artwork loopback server; `npm run start:synthetic` keeps the same preflight before staging checkerboard assets; `npm run tauri:dev` preserves the existing version check first, validates the same Angular source, then the existing Tauri WebView security configuration, before preparing the icon or starting the native host. The gate is a one-time startup preflight, not a live watcher: restart the dev command after changing `angular.json`. The catalog-enabled Tauri build entrypoints check Angular inputs after the mandatory version guard and **before** fetching optional city resources. The manual Windows PowerShell bootstrap checks versions and Angular inputs before any `npm ci`; it still uses the ordinary `build:ui` gate again before packaging. Direct `ng serve`, `ng build` or Tauri CLI invocations can bypass npm guards; use the documented workflow.

## Validation

Run from the repository root:

```powershell
node --test tests/angular-source-config.test.mjs
node scripts/verify-angular-source-config.mjs
npm run verify:version
npm test
npm run build:ui
# When the authorized sibling Charts and Astrological Assets checkouts are installed:
npm start
# On a public-only checkout without approved artwork, instead:
npm run start:synthetic
# In a second terminal, with npm start still running:
npm run tauri:dev
```

The focused tests cover the committed config, external scripts/styles, unexpected asset roots and replacements, additional projects/targets, public path drift, critical-CSS and font toggles, dev-server changes, malformed input, oversized files, symlinks, duplicate JSON object keys and Unicode-escaped aliases, file replacement between `lstat` and open, post-stat file growth, invalid UTF-8, descriptor closure, and correct startup guard ordering for both development commands, city-catalog builds and the Windows bootstrap. Native Windows/WebView2 and full Angular builds require the authorized checkout and upstream Charts package.

**Focused local checks (Node.js 22.16.0):** `node --test tests/angular-source-config.test.mjs`: **15 passed, 0 failed**. `node scripts/verify-angular-source-config.mjs` and `node --check scripts/verify-angular-source-config.mjs` passed. In a disposable source-only mirror with intentionally modified `angular.json`, six npm entrypoints short-circuited with the expected sanitized error; the version-check command in this mirror was a harmless stub so this is not a full Tauri verification. The test and preflight source Git blobs committed on this branch match the locally exercised bytes, including the added duplicate-key tests. The full repo suite, Angular compilation, Windows GUI and native Rust verification have not been run.

## Boundaries

This checker does **not** verify package dependencies, run JavaScript static analysis, prevent malicious modification to already-approved source paths, or certify CSS loading, network isolation, signing, asset ownership, scientific accuracy or the generated Windows executable. Continue to run the existing privacy, CSP, IPC, CSS, JS, asset and native build gates. If an Angular configuration change is legitimate, review it with the privacy/packaging owners, update the pinned config and add negative tests rather than bypassing the gate.

No production accounts, tokens, birth records, restricted city catalog, third-party artwork, GitHub Actions, deployment, public visibility change or release are involved.

## Reconciliation with the version gate

Integrated from draft PR #192 onto the main branch after the version preflight entered main. All five Tauri npm entrypoints retain `npm run verify:version` first. Both normal UI builds and the dev server use the Angular source guard, while catalog-enabled builds guard before fetching protected city resources. The existing Tauri security test continues to check the same CSP and dev command, with the new guard inserted. No schema, capability or lockfile modification is required.
