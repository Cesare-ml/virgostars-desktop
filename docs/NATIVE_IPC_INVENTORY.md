# Native IPC inventory — offline, fail-closed source audit

**Status:** local developer verification only (13 November 2026). This is not a native security audit, penetration test or a proof that a released Windows application is safe.

## Why this gate exists

VirgoStars Desktop's synthetic prototype has exactly two intentionally local Tauri commands: `desktop_runtime_info` (read-only capability probe) and `search_offline_places` (read-only SQLite/FTS5 place search). A change to Rust's command registry, the TypeScript transport contracts or Tauri privileges must not be mistaken for a harmless UI refactor.

Run `npm run verify:ipc` or `node scripts/verify-native-ipc.mjs` from the repository root. The script requires no installed npm dependencies, Rust compiler, catalog database, network access, user profile, account login or private data. It exits nonzero on unexpected registry/adapter/capability changes. Its CLI deliberately prints only a generic failure, not source text or personal paths.

## Exactly what is checked

- The Rust Tauri builder has exactly one explicit `generate_handler![...]` registration with the two reviewed commands, no duplicate or extra handler names.
- The two corresponding Rust modules expose exactly the expected `#[tauri::command]` public functions.
- The two matching TypeScript protocols use the known literal command names.
- Direct `@tauri-apps/api/core` imports in desktop TypeScript application sources occur only in two reviewed transport adapters (`runtime.ts` and `offline-places.ts`), which pass their typed `command` argument to the Tauri API.
- Tauri `app.security.capabilities` is still the empty explicit list, and `app.withGlobalTauri` is not enabled.
- New command names, additional direct Tauri imports and expanded capabilities **fail closed**. If these changes are later approved, update the allowlist, tests, documentation and threat model in the same reviewed PR.

## Limitations and acceptance

This is a narrow **source-level regression gate**, not a full Rust/TypeScript parser. It cannot detect string-building tricks, unregistered code in additional Rust modules, privileged imports from non-TypeScript frontend files, frontend XSS, misconfigured production permissions, unauthorized native plug-ins or malicious code in dependencies. Do not cite a green audit as proof of complete IPC confinement.

Run `npm test`, `npm run verify:ipc`, `npm run build:ui`, `cargo test` and inspect the compiled Tauri permissions and WebView2 behavior on an authorized Windows checkout before approving security-sensitive native changes. Any future Rust ephemeris, device-authentication, secure storage or sync command needs its own contract, privacy and authorization review; never silently extend these demo commands.

The audit contains no astronomical computation, user birth records, credentials, network requests, DB migrations, releases, GitHub Actions, production changes or dependency additions. It does not modify Tauri permissions.
