# SQLite v2 ACK ledger — replay and mutation-ID reservation reference

**Status: locally tested synthetic reference only (Node 22.16.0 / SQLite test harness).** This is NOT a production migration, a functioning sync client or encrypted data storage.

## The missing durability invariant

The v1 outbox schema deletes an acknowledged mutation in the same transaction that updates its entity revision. Once deleted, however, a process restart loses the local evidence that its `mutation_id` was already accepted. A late duplicate ACK cannot be distinguished from an unknown ACK, and buggy client code could reuse that ID for a new edit.

`contracts/sqlite/0002_ack_ledger.sql` extends the existing v1 **fictional plaintext** schema with a profile-scoped `local_ack_ledger(profile_id, mutation_id, server_revision)` and two SQLite triggers that reject reusing an acknowledged ID on either an INSERT or a mutation-ID/profile-ID UPDATE in the outbox. No birth record or mutation payload is copied into the ledger. The ledger itself still contains pseudonymous identifiers and requires protection under the future encrypted native store.

The test reference demonstrates the following **single-transaction** accepted/`already_applied` flow:

1. Validate the exact pending mutation and its profile; require it to be the oldest unresolved mutation for the entity.
2. Set that entity's accepted server revision, add the `(profile, mutation_id, revision)` ledger row, and delete the outbox row in the **same `BEGIN IMMEDIATE` transaction**.
3. On a later ACK with no pending row, look up the stored `(profile, mutation_id)`. The **same server revision** is a safe duplicate and makes no database changes; an unknown ID or different revision is rejected. The fixture treats the `accepted` and `already_applied` response kinds as equivalent when the revision matches.
4. A new local edit must choose a fresh mutation ID. The SQLite triggers reject reuse even if a caller bypasses the reference helper. An accepted ID in another profile is independent.

This does not authorize or authenticate an ACK. It merely proves local accounting semantics with fake data. An actual server must enforce ownership, idempotency, revision and session scope independently.

## Migration gate

Only an audited Rust/SQLCipher migrator should eventually apply this pattern to real user profiles. The **test** checks `PRAGMA user_version = 1` and `foreign_keys = ON` before running the v2 SQL under `BEGIN IMMEDIATE`, checks `foreign_key_check` and `integrity_check`, and commits `PRAGMA user_version = 2` atomically with the table and triggers. Unknown versions or migration failure must halt without deleting v1 records. `CREATE TABLE` and `CREATE TRIGGER` deliberately omit `IF NOT EXISTS`; rerunning v2 is an error, not a silent partial repair.

The eventual native migrator additionally needs an independently audited SQLCipher configuration, OS-wrapped per-profile keys, encrypted backup/recovery before migration, an application lock, disk-full and forced-process-kill tests, a reviewed rollback procedure, and key rotation. Plain `node:sqlite` is never an acceptable store for personal data.

## Verification

Run from the repository root on Node 22.16+:

```sh
node --experimental-sqlite --test tests/sqlite-ack-ledger-reference.test.mjs
```

The synthetic test creates a disposable on-disk SQLite database and covers version upgrade, existing pending edits, reopening after an ACK, old-ACK replay without overwriting newer edits, wrong-revision rejection, DB-level ID reuse triggers, multi-profile isolation, rollback before ACK commit, out-of-order ACK rejection, migration rollback/retry, strict constraints, and the explicit absence of SQLCipher in the test environment.

**Performed locally on 2026-11-14:** 10/10 tests passed with Node 22.16.0. A rollback caused by a **simulated exception** is tested; a real forced OS process termination during this new v2 operation has not yet been tested. Native Rust and WebView2 builds have not been run.

## Remaining design decisions

- **Ledger retention and account deletion:** An ACK ledger cannot be deleted while arbitrary late duplicates or mutation ID reuse remain possible. Define bounded retention jointly with server replay guarantees, device revocation and a secure local profile-delete policy. A profile must not be left undeletable by its FK-protected ledger; reviewed deletion should clear it in the same protected transaction as other profile-owned records.
- **Queue migration / concurrency:** A production worker must serialize writes against the migration and against the ack transaction. The test is single-process only; it does not prove multi-window or cross-device contention behavior.
- **Conflict and retry:** Only successful `accepted`/`already_applied` ACKs are ledgered. Conflict rows must remain unresolved and visible to the user; `retry` must keep the mutation pending. The v1 conflict contract remains unchanged.
- **Remote trust:** The backend authorization and signed-in account/device flow do not exist for this Desktop prototype. Do not wire this reference to the real hosted service.
- **Production release:** This work adds no new Tauri IPC command, network request, updater, login, astronomical engine, data pack, installer or deployment; CPAL/NOTICE and repository visibility remain unchanged.
