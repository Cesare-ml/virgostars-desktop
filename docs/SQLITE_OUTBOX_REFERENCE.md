# SQLite local outbox — migration and crash-recovery reference (002)

**Status:** synthetic, standalone **test reference only**. No Rust implementation, SQLCipher encryption, actual application persistence, credential handling or network synchronization exists in this slice.

This complements `OFFLINE_AUTH_AND_SYNC.md` and `OFFLINE_OUTBOX_REFERENCE.md`. It is intended to become the behavior and migration fixture for a **Rust-owned, encrypted SQLCipher** implementation after a separate security/architecture review. It MUST NOT be connected to real subjects, accounts, notes or profile data; plaintext SQLite is used **only** inside automatically deleted test directories.

## Scope

- `contracts/sqlite/0001_local_outbox.sql`: SQLite STRICT tables, profile-scoped entities, mutations, tombstones and sync cursor. Composite foreign keys ensure an outbox entry always references an entity belonging to the same profile. Strong foreign keys must be enabled **on each connection**.
- `tests/sqlite-outbox-reference.test.mjs`: a real local temporary file; `BEGIN IMMEDIATE` transactions; durable row+mutation together, durable receipt+revision together, cursor+pulled-page together. Tests close/reopen the database, kill a subprocess with SIGKILL before COMMIT, enforce profile isolation, preserve conflicts and tombstones, and reject malformed JSON/operations.
- The experiment uses Node 22's experimental `node:sqlite` **only as a portable test harness**. It must never become the privileged production persistence layer.

### Run tests

From the repository root, with Node.js 22.16.0:

```powershell
node --experimental-sqlite --test tests/sqlite-outbox-reference.test.mjs
```

No npm, Rust, production secrets or network access are required. Note: `node:sqlite` has an experimental API on this version of Node; adjust the testing tool independently if that changes. Running it creates a temporary, clearly fictional plaintext SQLite file and automatically removes it. The test should fail if plain SQLite is unexpectedly presented as encrypted (`PRAGMA cipher_version` is absent).

**Executed on 2026-11-10:** 10/10 SQLite tests passed with Node.js 22.16.0 and SQLite 3.49.1 (Node built-in). This does **not** constitute SQLCipher, Angular, Rust, Tauri, WebView2 or Windows validation.

## Contract and safety invariants

1. Entity edit and immutable outbox insert are one transaction. A failed duplicate ID rolls back any entity edit. Mutable in-process objects must not be used as storage identifiers.
2. `profile_id` appears in primary/unique and foreign keys; one profile's acknowledgment must never change another profile's revision.
3. Only the oldest unresolved mutation for a given `(profile, entity type, entity ID)` is eligible to send. A conflict blocks later mutations for that entity, but not unrelated entities. Bounded batch size 1–500.
4. On receipt, locate and validate the exact pending mutation and oldest entity sequence; update the entity revision and remove the acknowledged mutation **in the same transaction**. A missing revision is an error. A conflict leaves the record pending in a `conflict` state; no silent merge or deletion.
5. `delete` is represented by a tombstone plus a pending delete mutation. It is not represented by absence. Tombstones remain after acknowledgment until the server-approved retention policy is established.
6. Apply pulled changes and advance the opaque profile cursor **atomically**, never overwriting an entity with unresolved local edits. Interrupted batches must not advance the cursor.
7. A crash before commit must not leave half an edit or a cursor at a falsely advanced position. WAL mode is used in the test; checkpoint/backup and disk-failure scenarios require separate drills.

## Explicitly not implemented

- **Encryption:** SQLite used here is plaintext. The production Rust adapter must **fail closed** without SQLCipher support, require a properly established per-profile encryption key before reading schema, verify the encryption runtime (e.g. nonempty `PRAGMA cipher_version` and integrity checks), use OS secure key wrapping (Windows DPAPI/Credential Manager; macOS Keychain) and never persist that key or sensitive payload in logs. No plaintext fallback permitted. Review SQLCipher packaging, license and key rotation before accepting it.
- **Authentication/authorization:** this fixture does not establish identity. Account ownership must be verified server-side for every mutation and pull. Do not directly expose this SQL or arbitrary file paths to Angular IPC.
- **Idempotency across acknowledged mutations:** local sent/ack tombstone receipts or a durable ledger may be needed to reject reusing an already-acknowledged ID. The backend independently needs idempotent `mutation_id` processing.
- **Dependent revisions:** second offline edits of a single entity retain their old base revision until a separate explicitly defined rebasing/conflict policy. No automatic last-write-wins.
- **Migrations:** `IF NOT EXISTS` + `user_version=1` is an illustrative first version, not a safe production migration engine. Future runner must reject unknown schema versions, perform backup/rollback and enforce migration provenance.
- **No sync protocol yet:** no backend routes, cursor expiry handling, multi-device scenario, server-owned scope or real network requests have been implemented.
- **No secret-free path for personal records in tests:** all test labels deliberately contain the word Synthetic/Fictional; no user exports or screenshots.

## Next implementation gate

Create a separately-reviewed `src-tauri/src/storage` Rust adapter using an audited SQLCipher package and OS-bound secret management, with tests mirroring the reference corpus (local edit, duplicate ID rollback, forced termination, profile separation, queued deletes, ACK + revision, cursor crash). Show `cipher_version`, encrypted-at-rest file inspection, key rejection and migration behavior in Windows 11. Only after that, bind a **narrow, typed Tauri command** for profile-scoped authorized operations; never expose raw SQL or a database path to the frontend.

No merges, deployment, GitHub Actions, repository publication, signing/release or changes to production are part of this reference.
