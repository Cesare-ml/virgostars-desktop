# VirgoStars Desktop — native private-storage boundary gate

**Status:** locally tested, read-only source preflight. This does **not** implement
private storage, encryption, a secure key store, login, migrations or production
sync. It exists to make an accidental plaintext storage integration visible.

## Current architecture

The shipping Tauri spike links `rusqlite` 0.32 with `bundled` SQLite for **one
read-only packaged city catalogue**. That is not encrypted and must never be
repurposed for private subjects, notes or birth records. The separate draft
SQLCipher work (beginning at PR #14, `crates/encrypted-outbox-spike`) is a
**fictional, unlinked Rust prototype**, not a ready-to-use account archive.

The `verify-private-storage-boundary.mjs` preflight reports either
`city-catalog-only` or `isolated-synthetic-sqlcipher-spike`, always with
`privateStorageAvailable: false`. It checks:

- the reviewed Tauri module inventory and registrations have not expanded;
- native SQLite dependency remains the already-reviewed city catalogue one;
- Rust code outside that city reader does not begin to use SQLite without review;
- if an isolated SQLCipher crate appears, it has its own workspace, `publish =
  false`, pinned `rusqlite`, disabled defaults, and exactly one reviewed
  `bundled-sqlcipher*` feature — never the ordinary plaintext `bundled` mode;
- the standalone crate has not been linked into the shipping Tauri host.

This is a **conservative source/manifest tripwire**, not proof against obfuscated
or indirect database access. Intentional additions to native modules, SQLCipher
features or real private-store wiring will require a separate, documented
review and updating this gate. Never weaken it just to make a build pass.

## Run

```sh
node scripts/verify-private-storage-boundary.mjs
node --test tests/private-storage-boundary.test.mjs
npm run verify:ipc
```

The last command runs the existing native IPC audit, then this independent
private-storage preflight. It is read-only, requires only Node and local source
files, and does not open database files, inspect user directories or log paths.
The existing Windows/bootstrap native IPC gate therefore also invokes it.

Synthetic tests check an isolated correct manifest, mixed/plaintext fallbacks,
missing dependency pins, publication/workspace policy, unreviewed Rust modules,
unauthorized native SQLite use, linked spike dependencies and a source checkout
when available.

## Gates before a real profile archive

1. Review the standalone Rust/SQLCipher tests with a working Rust/Windows MSVC
   environment; verify actual encrypted file bytes, wrong-key rejection,
   `PRAGMA cipher_version`, integrity and FK checks **without** plaintext fallback.
2. Design OS-protected per-profile keys, device unlock and revocation, secure
   deletion and backup/restore. Never embed credentials or persist them in
   browser `localStorage`.
3. Review schema v1/v2/v3, durable outbox and conflicts together; never
   silently overwrite a remote edit. A separate authorization decision must
   precede native IPC changes and actual local user data access.
4. Re-run `npm test`, Windows native build and WebView2 offline acceptance after
   any integration. No release or production deployment is covered here.

No new Tauri IPC command, license, GitHub Action, telemetry, private dataset,
production dependency or account API is added by this preflight.
