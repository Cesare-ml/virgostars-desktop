# Angular source configuration — pre-build approval gate

**Status:** source-only, synthetic testable guard. Not proof of a safe package, native runtime or approved release.

## Problem and scope

The existing offline bundle verifiers inspect **generated files**. Angular `ng build`, however, reads `angular.json` *before* output inspection. An unreviewed addition to `scripts`, `styles`, `assets`, `fileReplacements`, builder options or the dev-server target could change what is compiled or execute unintended build inputs. The source gate makes those changes explicit review events.

`scripts/verify-angular-source-config.mjs` accepts exactly the reviewed `desktop` project and its synthetic and optional private-artwork inputs, including CSS critical-inlining disabled for the current CSP, no font network optimization and no extra build projects/options. It rejects any unknown field, altered path, new configuration or changed optimization option. This is an intentionally strict equality policy rather than a general-purpose Angular config linter.

Both `npm run build:ui` and `npm run build:ui:private` run the read-only check **before** staging or invoking Angular. The normal Tauri build scripts depend on these UI build commands. Direct `ng build` or direct Tauri CLI invocations can bypass npm guards; use the documented workflow.

## Validation

Run from the repository root:

```powershell
node --test tests/angular-source-config.test.mjs
node scripts/verify-angular-source-config.mjs
npm test
npm run build:ui
```

The focused tests cover the committed config, external scripts/styles, unexpected asset roots and replacements, additional projects/targets, public path drift, critical-CSS and font toggles, dev-server changes, malformed input, oversized files and symlinks. Native Windows/WebView2 and full Angular builds require the authorized checkout and upstream Charts package.

## Boundaries

This checker does **not** verify package dependencies, run JavaScript static analysis, prevent malicious modification to already-approved source paths, or certify CSS loading, network isolation, signing, asset ownership, scientific accuracy or the generated Windows executable. Continue to run the existing privacy, CSP, IPC, CSS, JS, asset and native build gates. If an Angular configuration change is legitimate, review it with the privacy/packaging owners, update the pinned config and add negative tests rather than bypassing the gate.

No production accounts, tokens, birth records, restricted city catalog, third-party artwork, GitHub Actions, deployment, public visibility change or release are involved.
