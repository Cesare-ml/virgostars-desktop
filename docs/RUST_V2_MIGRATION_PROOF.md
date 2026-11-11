# Rust SQLCipher — explicit v1-to-v2 migration proof (006)

**Status: experimental, synthetic-only. No production authorization.**

This branch is stacked on draft PR #19 and extends the standalone
`crates/encrypted-outbox-spike` package. It does **not** connect to Angular,
Tauri IPC, users, an API, a device key manager, existing application databases
or production. No automatic schema upgrade is enabled.

## Concrete implementation

- `SCHEMA_V2` includes exactly `contracts/sqlite/0002_ack_ledger.sql`
  approved as a reference in draft PR #19.
- `SyntheticEncryptedStore::migrate_synthetic_v1_to_v2` is an **explicit call**.
  It checks the current v1 schema catalogue and referential integrity, begins
  an immediate transaction, applies v2 DDL, compares the complete resulting
  metadata to a same-engine memory-only v1+v2 DDL template, checks foreign keys
  and `user_version=2`, then commits.
- Three new Rust unit tests **authored but not executed** cover successful
  encrypted migration preserving a pending mutation, forced pre-commit
  rollback, and rejection of an altered v1 schema. The isolated crate now
  contains **17 authored Rust tests**.
- The normal `SyntheticEncryptedStore::open` deliberately **rejects v2**.
  Even if a test calls the explicit migration on an already-open v1 handle,
  every public read/write method checks the schema version and refuses
  operations afterward. This is a deliberate **fail-closed** boundary: the
  v2 ACK writer, stable cross-language request fingerprint, key custody and
  approved migration runner do not yet exist.

**Why no automatic migration?** There is not yet a reviewed SQLCipher
backup/restore mechanism or OS-protected key provider. Migrating a real user
profile automatically would be unsafe, so the only current use case is an
isolated synthetic test database.

## Tests actually executed

`tests/sqlite-v2-migration-boundary.test.mjs` mirrors these *transactional
SQLite invariants* using Node's **plaintext in-memory SQLite test engine**, not
SQLCipher. The five tests check:

1. v1→v2 preserves unacknowledged synthetic records and FK integrity.
2. Injected failure before COMMIT restores the entire v1 schema, version and
   outbox.
3. Repeated migration is refused.
4. A modified v1 index is rejected even if `user_version` still equals 1.
5. Orphaned profile/entity foreign keys block migration.

**Executed:** 2026-11-11, Node 22.16.0, **5/5 passed**.
The checked-in test matches the exact locally executed Git blob
`0d9a04859c8f29e2625a3c06bfd635761690c185`.
Both v1 and v2 schemas also matched their current Git blob hashes:
`013b80914fb2fc1bbb66ff266e7f7a069b96e794` and
`306e343ff3f8e3e9637ee4111379ea5b8527c699`.

**Not executed:** Rust `cargo check/fmt/clippy/test`, actual SQLCipher
migration or ciphertext validation, Windows PowerShell script, Windows or
macOS integration, OS key custody, native crash recovery or cloud sync.
The Node result **cannot** substantiate that Rust compiles or that
an encrypted migration succeeds on disk.

## Manual developer gate on Windows 11

From the feature branch:

```powershell
node --experimental-sqlite --test tests/sqlite-v2-migration-boundary.test.mjs
powershell -NoProfile -File .\crates\encrypted-outbox-spike\validate-windows.ps1
```

The latter now includes all synthetic SQLite reference suites. It intentionally
reports NOT READY without a reviewed Cargo.lock, and it neither provisions
credentials nor accesses real account files. After installing an approved
MSVC/Rust/SQLCipher toolchain, inspect dependency versions, verify correct
cipher linkage, run Rust tests (including migration), and perform an encrypted
backup/restore, wrong-key/corrupt-file and mid-transaction interruption drill.

## Blocking security and compatibility work

- **Historical ACK information is not recoverable from v1:** a v1 outbox
  entry was removed on acknowledgement. An empty v2 ledger cannot prove which
  IDs were already used prior to upgrade. An approved server-side idempotency
  and reconciliation policy is essential; do not assume v2 alone closes this
  historical gap.
- Implement a fully reviewed v2 Rust ACK ledger with per-profile uniqueness,
  canonical versioned fingerprint, immutable persisted request snapshot,
  atomic ACK+revision+delete, and cross-language golden vectors.
- Keep owner authentication and server authorization independent from local
  integrity checks. Never assume the client-side ledger authenticates receipts.
- Before real users: encrypted backup, atomic migration, crash and rollback,
  disk permissions/symlink containment, key rotation and DPAPI/Keychain
  integration, audited schema/migrations, and manual Windows native testing.
- No plaintext fallback, implicit v2 acceptance, logging of sensitive data,
  production deploy, merge to main, GitHub Actions or release.

**This PR is a source-and-test migration reference, not an activated account upgrade.**
