# Native profile-status generation fence — internal Rust prototype

**Status: proposed native foundation; Rust unit tests written but not yet compiled or executed.**
This is a standalone, synthetic-only lifecycle helper. It is **not** a
working secure offline profile, storage API, authentication, SQLCipher adapter,
keychain, server sync engine or Tauri IPC command.

## What changed

- `src-tauri/src/profile_status_generation.rs`: pure std Rust
  `ProfileStatusGenerationFence` with opaque `ProfileStatusTicket`.
- `src-tauri/src/lib.rs`: compiles the internal module without registering
  a Tauri handler or modifying the existing two-command IPC allowlist.
- `tests/profile-status-generation-source.test.mjs`: seven read-only Node
  source-contract checks covering native IPC isolation, opaque instance-bound
  tickets, checked epoch advance, poison/overflow handling, and coverage of
  Rust regression scenarios.

The fence provides three lifecycle operations:

1. `begin()` invalidates any older status read and returns a token for the
   newest generation, or `None` on poisoned/overflowed state.
2. `complete(&ticket)` consumes **only** one reply for the current generation.
   Copies and old replies return `false`. Ticket instances are distinguished by
   `Arc::ptr_eq`; equal numeric generations from separate fences never match.
3. `invalidate()` revokes pending replies synchronously on a future lock,
   logout, profile switch or teardown.

`is_current()` is a non-consuming freshness hint; it must **not** be used to
authorize data reads through a check-then-use sequence. The fence uses a
`Mutex` and no unsafe code. If a generation overflows it fails closed; if
the state mutex is poisoned, new reads cannot begin and old replies are
rejected. It contains no profile ID, actual account state, keys or privileges.

## Critical security separation

A ticket only means that a synthetic **status** callback is not stale. It
does **not** prove an account, local unlock, encrypted database integrity,
remote revocation or ownership. A future vetted Rust storage adapter must
enforce all real permissions, profile isolation and secret lifetime within
the native host. The frontend and these freshness tokens cannot enforce
access. Neither this module nor its tests are connected to Tauri commands,
SQLCipher, actual records, production auth or network APIs.

A disconnected device still cannot discover an unseen remote revocation.
There is no promise of immediate server revocation while offline. Never
enable a native `unlocked` response or status-derived data access until the
independent keychain/SQLCipher and authorization gates are reviewed.

## Verification

The actual GitHub committed new files match the locally checked Git object
hashes: Rust module `e33b6bbde06e4b41e45fb46cf53896d1bf70a22a`,
native module registration `c0f00c5496d5b615f67a468f1279d32abbbb61c2`
and source audit `f8eafb03020c4f2a5d8df61b312f2e3fda998582`.

**Executed in a local mirror, Node.js 22.16.0:**

```sh
node --experimental-strip-types --test \
  tests/profile-status-generation-source.test.mjs \
  tests/offline-profile-notify.test.mjs tests/offline-profile-timeout.test.mjs
```

**25/25 passed** (7 source-audit tests and 18 TypeScript behavior tests).
Standalone TypeScript 5.8.3 strict compilation of the status reader and
generation guard also passed. The source audit cannot validate Rust semantics
or replace native compilation.

**Written but NOT executed (no Rust compiler available in authoring runtime):**

```sh
cd src-tauri
cargo test --locked profile_status_generation -- --nocapture
```

The seven Rust unit tests cover latest-only/once-only, logout invalidation,
cross-instance rejection, 10,000 refreshes, 16 competing completions,
overflow and poisoned mutex. A contributor must run `cargo test --locked`
with Rust 1.90 or later and review its real output before merge. The
complete `npm test`, Angular/Tauri builds, native SQLCipher and Windows
WebView2 smoke were **not executed**.

## Next gates

1. Review native Rust semantics and run all Cargo unit tests in an authorized
   Windows toolchain with the existing two-command IPC registry audit.
2. Implement native *profile-specific* encrypted storage and key validation
   separately. Bind the fence only to a reviewed profile-lifecycle adapter;
   do not return keys, account identifiers or arbitrary paths to the WebView.
3. Test rapid account switching, lock/logoff and delayed native operations
   against real native cancellation and authorization policy. An internal
   freshness fence is not a replacement for the storage security model.

No GitHub Actions, release, visibility change, deployment, production
connection or merge is included in this prototype.
