# Durable ACK ledger v2 — synthetic reference

**Status: REFERENCE ONLY.** This is a stand-alone, plaintext SQLite/Node test model containing **fictional data only**. It is not integrated with Rust, Tauri, SQLCipher, real user profiles, authentication or VirgoStars cloud. The actual Rust encrypted-outbox spike on PR #15 still deliberately **accepts only v1**. Do not execute this migration on it or on any real database.

## Problem being addressed

In v1, accepting a mutation removes its outbox row. After a crash, restart or later local edit, the database no longer knows that the same `mutation_id` was already acknowledged. An accidentally recycled identifier could be treated as a new operation. On unreliable connections, a duplicate server receipt can arrive after the original acknowledgement was committed.

## New reference files

- `contracts/sqlite/0002_ack_ledger.sql`: proposed **v1→v2 migration** for `local_ack_ledger` with per-profile primary key, exact request fingerprint, outcome, server revision, UTC acknowledgement time and foreign key to the profile.
- `tests/sqlite-ack-ledger.test.mjs`: temporary in-memory/file-backed synthetic reference. Shows one transaction for ledger insert + local revision update + outbox deletion; replay policy; request-body check against **persisted pending snapshot**; strict non-reuse of mutation identifiers; rollback after injected failure; account isolation; durability after reopen.

## Rules for a future encrypted Rust implementation

1. The **server** independently validates ownership, device access and global/per-owner mutation idempotency; this local ledger is not authorization and does not prove server truth. A forged receipt must never be accepted solely because its mutation ID is recognizable.
2. At enqueue, compare the ID against **both** unacknowledged outbox entries and durable ACK ledger, *before* changing the entity. A previously acknowledged byte-identical request may return already-acknowledged without a new entity write; a divergent request with that ID is rejected.
3. Before acknowledging, reconstruct the request from the **persisted** outbox snapshot, not mutable UI data or a server-supplied payload. Require a matching canonical fingerprint, oldest eligible operation and expected server revision.
4. Atomically record receipt, update entity revision and delete the exact outbox row. On rollback/crash, none may persist alone. Duplicate acknowledgement must match stored fingerprint, result and revision or fail closed.
5. **Canonical request encoding is not yet finalized.** The Node fixture sorts object keys and hashes JSON using SHA-256 solely to exercise consistency. A cross-language versioned canonicalization standard and Rust/TS golden vectors are needed before production. A raw SHA-256 is not a MAC, encryption, authentication or privacy guarantee.
6. Ledger rows may need long-term retention to avoid mutation-ID reuse. Decide retention, backups, multi-device pruning and server-side idempotency windows *before* any deletion. Sensitive fields must remain inside **reviewed encrypted SQLCipher** storage.
7. This migration's `PRAGMA user_version=2` is executable **only** inside a caller-controlled transaction after verifying a real v1 schema and having an encrypted backup/rollback process. Do not enable automatic migration of the current encrypted spike. Reopening v2 with the current v1-only Rust code must fail closed until a dedicated upgrade runner and v2 schema verifier are implemented.
8. No cloud API or authenticated sync contract is implied here. No developer test fixture should contain real birth subjects, passwords, API keys or production exports.

## Validation

With Node.js 22.16.0, run from the repository root:

```powershell
node --experimental-sqlite --test tests/sqlite-ack-ledger.test.mjs
```

**Executed locally on 2026-11-11:** 10/10 Node SQLite reference tests passed with synthetic data; no Rust build/SQLCipher/Windows GUI validation was performed. The test executable and migration must be read back and compared with the locally tested content after pushing.

## Future gates

- Approve v2 entity/receipt schema, including refusal of unsupported schema versions and encrypted migration backup/restore.
- Implement migration transaction and ACK ledger in Rust SQLCipher with equivalent integration tests, including crash/reopen and wrong key.
- Add contract tests against an explicitly approved staging-only backend supporting idempotent mutations and authorization.
- Evaluate credential scope, DPAPI/Keychain wrapping, disk encryption and key rotation before accessing any real user records.

No production changes, main merges, licensing decisions, GitHub Actions or deploys are part of this PR.
