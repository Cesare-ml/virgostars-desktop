# Rust v3 keep-local conflict decisions — synthetic prototype

**Status: draft source only. Not integrated into Tauri, accounts, or production.**
Stacked on draft PR #29, which establishes the immutable SQLite v3 decision schema.

## Implemented Rust method

The file crates/encrypted-outbox-spike/src/ack_v3_keep_local.rs introduces
SyntheticEncryptedStore::keep_synthetic_v3_local_conflict with explicit original
ID, replacement ID, expected ACK-FP-001 fingerprint, decision time, and a
synthetic fault-injection flag.

In an IMMEDIATE SQLCipher transaction, the method:

1. Verifies exact schema v3, foreign keys, fictional profile/IDs and the
   persisted original outbox fingerprint, not a mutable UI payload.
2. Replays an identical historical decision as a no-op only when fingerprint,
   replacement ID, choice and timestamp ALL match. Otherwise it fails closed.
3. Requires a recorded conflict, a remote conflict revision, no dependent
   pending edits and no intervening changes to the local entity snapshot.
4. Forbids replacement IDs present in the outbox, ACK ledger or any original
   or replacement history entry.
5. Deletes ONLY the old conflicted queue row; sets the entity server base
   to the recorded conflicting revision; creates a NEW pending ID preserving
   the original fictional payload/tombstone; then inserts the original full
   snapshot into append-only decision history LAST. This order is mandatory
   because the SQL ID-retirement trigger must allow the initial insertion.
6. Commits all related changes together. A forced precommit error rolls back
   everything. A new pending edit is NOT represented as server-synced.

All methods are synthetic-only and require explicit v3 opening. Default v1/v2
constructors refuse v3. The crate is not linked into any desktop IPC command.

The SQL v3 append-only history triggers forbid direct UPDATE/DELETE, and the
ID-retirement trigger rejects reuse of acknowledged and retired mutation IDs.
**Accept remote version is intentionally NOT implemented**: it requires an
authenticated owner-scoped remote snapshot and explicit user confirmation.

## Verification

**Actually executed with Node 22.16.0:** all 31 reference SQLite tests passed
(10 v2 enqueue, 7 v2 conflicts, 14 v3 decisions), with only fictional
temporary plaintext records. The strict TypeScript check for the shared
ACK-FP-001 canonicalizer also passed.

Exact tested GitHub Node test blob:
91039c6ed818ce14ba3c55e7e2e86b9eaa017677

Unchanged reviewed v3 SQL blob:
960f1894d0c592597451df779d4d3df783b0d140

Nine Rust unit tests were authored in the new source module covering:
atomic decision, replay mismatch, wrong hash/ID/profile, dependent edits,
encrypted reopen after rollback, history immutability, delete tombstone,
ACKed-ID reservation, and later local changes.

**Rust/Cargo/SQLCipher tests have NOT been executed here.** The environment
does not have cargo, rustc or rustfmt. A Node SQLite test does not validate
native Rust code, SQLCipher, its encryption, Windows storage, or native
transaction behavior. The existing manual Windows validation script already
includes the v3 Node suite and will discover new Rust tests once Cargo exists.

## Non-negotiable gates

- Compile with reviewed Windows MSVC/Rust + SQLCipher toolchain, audit
  Cargo.lock, run format, Clippy and the complete Rust test suite.
- Test encrypted file reopen/rollback, wrong key, corruption, backups,
  OS key custody and crash interruption; no plaintext fallback.
- Design an authenticated per-owner server receipt and idempotent sync API.
  A local SHA-256 fingerprint is a consistency marker, not authentication.
- Replace fictional ASCII/integer-only ACK-FP-001 with a reviewed
  Unicode/decimal-compatible version before using real astrology data.
- Add actual Tauri UI only after server/API, device authorization and
  profile handling are approved. New edits must not be reported as synced.

No real records, production changes, GitHub Actions, main merge, release,
repository visibility or license modification are part of this PR.
