# Rust SQLCipher outbox spike 003

**Status:** isolated Rust **source prototype**, private, synthetic only; NOT linked into Tauri or approved for real accounts. Written on 2026-11-10. The Rust code has **not** been compiled or tested in the authoring environment (no Rust toolchain available). There are **10 authored Rust tests** including the follow-up schema integrity checks, not 10 passing Rust tests.

## Why this is separate

This crate builds on [PR #11's pure TypeScript outbox contract](OFFLINE_OUTBOX_REFERENCE.md) and [PR #12's SQLite disk/crash reference](SQLITE_OUTBOX_REFERENCE.md). It does not modify \`src-tauri/Cargo.toml\`, Tauri capabilities, Angular, any production service, or a public release. That avoids duplicate development with the Angular/Tauri runtime branch.

**Source:** \`crates/encrypted-outbox-spike/src/lib.rs\`
**Standalone manifest:** \`crates/encrypted-outbox-spike/Cargo.toml\`
**Schema:** existing \`contracts/sqlite/0001_local_outbox.sql\` from PR #12 via \`include_str!\`.

## Concrete code added

- A proposed \`SyntheticEncryptedStore\` using \`rusqlite = 0.41.1\` **with \`bundled-sqlcipher-vendored-openssl\`**. No plain-SQLite build feature or fallback is present. The bundled OpenSSL/SQLCipher dependency tree and native toolchains require review before distribution.
- A 32-byte \`StoreKey\` wrapper with \`zeroize\`; the caller must provide cryptographically random key material from a separately reviewed OS secure-storage provider. There is **no key-generation, DPAPI, Keychain, token or account integration** in this crate.
- Open calls SQLCipher \`PRAGMA key\` as its first database action, verifies non-empty \`cipher_version\`, reads \`sqlite_master\` and runs \`quick_check\` to reject incompatible/incorrect keys; refuses symlinks (best effort), empty and unknown schemas; validates foreign key enforcement.
- A first-version schema is applied transactionally only for a genuinely new file. This is **not** a production migration runner; v2/rollback/backup tests remain required.
- Synthetic-only APIs enforce \`synthetic-\` identifiers and JSON size/validity; atomic subject update or explicit delete tombstone + outbox insert; one unresolved per entity in FIFO batch; conflict and accepted receipts; remote page + cursor in one transaction with a synthetic failure injection. A later synthetic upsert clears the local tombstone but does not bypass the preceding queued delete or conflict.
- Ten Rust unit tests (unexecuted here) for encrypted file header/reopen, wrong key, plaintext refusal, mutation rollback, same-entity conflicts, profile isolation, deletion/tombstone semantics and pull cursor rollback.

## How to verify on Windows 11

Install the reviewed Rust MSVC toolchain, C++ Build Tools, and dependencies for building vendored OpenSSL. In a **synthetic test workspace only**, run:

\`\`\`powershell
cargo test --manifest-path crates/encrypted-outbox-spike/Cargo.toml
\`\`\`

Then generate and review \`Cargo.lock\` for this standalone crate and repeat with \`--locked\`. Do not claim these tests pass until actual Windows execution; inspect the build logs for SQLCipher linkage.

Additional security acceptance before any integration:

1. Confirm \`PRAGMA cipher_version\` is nonempty with the exact bundled binary; verify encrypted file header and absence of plaintext fields via a file inspection, wrong key and plaintext DB refusal.
2. Test lock contention, process kill mid-transaction, backup/restore, damaged/corrupt files, corrupt WAL/journal, migration rollback and schema tampering, profile isolation, async cancellation.
3. Design a keyed OS secure store (DPAPI/Credential Manager on Windows, Keychain on macOS) without persisting the unwrapped key, passwords or personal records in logs. Review secret lifetime of SQLCipher's PRAGMA key statement and in-memory memory hygiene; consider using SQLCipher's binary \`sqlite3_key\` API to reduce transient textual key exposure after verifying FFI support and error handling.
4. Test cipher key rotation and correct files/profiles on two OS accounts. No "offline forever" promise in the presence of remote revocation.
5. Replace hard-coded fixture timestamps and \`synthetic-\` IDs with versioned, owner-authorized DTOs **only after** backend approval; ensure durable idempotency even after acknowledged mutations, dependent revision policies and tombstones.
6. Never surface raw DB paths, SQL, passwords, keys or arbitrary Tauri IPC methods to the renderer. SQLCipher source and OpenSSL redistribution/license obligations require review.
7. Test on macOS independently before making portability/release claims.

## Verified vs not verified

**Verified by GitHub read-back/static checks:** files, schema include path, named SQLCipher-only dependency, key zeroization, SQLCipher checks before migrations, synthetic-only inputs, transaction methods and Rust test source.

**Not verified:** compiling Rust, running Rust unit tests, SQLCipher runtime behavior, correct encryption on disk, Windows 11/macOS build, key custody, crash durability, Tauri integration, npm lockfiles, actual cloud sync.

This is a source code step only, not an encrypted shipping database. No automatic GitHub Actions, merge, deployment, visibility, licensing or release changes.

## Follow-up: fail-closed v1 schema integrity gate (draft PR #15)

The first source version trusted `PRAGMA user_version=1` and four table names. That is insufficient: an attacker, corrupted migration or accidental manual edit can retain the same names while changing the outbox indexes, constraints or tables.

The follow-up adds `validate_schema_v1` on **every encrypted open**, after the SQLCipher/key/data-page checks and before exposing a usable store. It creates an in-memory **DDL-only** template from the checked-in schema (no sensitive user data, disk files or keys), compares its complete `sqlite_master` catalogue (tables, indexes, triggers, views) to the encrypted file under the same linked SQLite engine, and checks `pragma_foreign_key_check`. Any difference or dangling foreign key rejects the store as `UnsupportedSchema`. This intentionally blocks ad hoc v1 schema modifications; future schema evolution requires a reviewed, versioned migration.

Additional Rust tests attempt to reopen a database after replacing an index, adding an unexpected table or introducing an invalid foreign key while enforcement was disabled. These tests remain **authored but unexecuted** until Cargo/SQLCipher is available. There are now **10 Rust unit tests authored**.

The test-only in-memory metadata template is not a plaintext fallback for personal data and is not a user database. The production gate still requires SQLCipher compilation, real Windows file encryption tests, OS-bound key management, a reviewed `Cargo.lock`, migration tooling, and backend authorization. Verify the `sqlite_master` DDL normalizations across supported SQLite versions during upgrade rehearsals; a mismatch must fail closed, not silently migrate.
