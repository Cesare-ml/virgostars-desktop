# Rust SQLCipher ACK v2 writer — synthetic development slice 008

**Status: source prototype / DRAFT.** This is part of the isolated private `crates/encrypted-outbox-spike` crate. It is **NOT** connected to the Tauri runtime, Angular, the cloud backend, real user profiles or key management. The crate's reference SQLCipher library has **not** been compiled in the authoring environment; no native Rust/SQLCipher test is claimed to pass.

## Added native code

- `src/ack_v2.rs`: `SyntheticEncryptedStore::apply_synthetic_v2_receipt(profile, mutation, expected_fingerprint, result, server_revision, fail_before_commit)`.
- Receipt consistency requires the **ACK-FP-001 hash of the persisted outbox snapshot**, reconstructed inside the Rust storage layer, not a mutable Angular or network payload. The caller's expected hash is only a consistency check, **not authentication**. It also validates profile/mutation synthetic identifiers, lowercase digest format, accepted/already-applied result and a printable, nonempty revision.
- A reused acknowledged mutation ID is returned as `Replayed` **only if fingerprint, result and revision all match** the durable acknowledgement ledger. Divergent repeats are rejected, without modifying the entity.
- An outstanding mutation must be the oldest for that profile/entity, in pending state, and based on the current stored server revision. Later dependent edits with an old base revision remain unsent; no silent rebase or last-write-wins.
- Ledger insert, entity revision update and outbox deletion run in **one `BEGIN IMMEDIATE` SQLCipher transaction**. An injected pre-commit failure must roll all three changes back.
- `SyntheticEncryptedStore::open_synthetic_v2` explicitly opens a previously migrated v2 synthetic file using the **same SQLCipher key, cipher version, HMAC/page-integrity, foreign-key checks and schema-catalogue validation** as the v1 constructor. The normal v1 `open` must still reject v2, and the explicit v2 constructor must reject v1. Existing v1 write APIs continue to reject v2.
- Corrected the crate header: Rust inner documentation comments (`//!`) must precede the module items. The prior branch placed `pub mod ack_fingerprint;` before them; this is a source-level Rust compilation defect fixed here.

## Tests authored

Six additional Rust unit tests in `src/ack_v2.rs` exercise:

1. Accepted ACK, v2 encrypted close/reopen and identical replay; inconsistent server revisions are rejected.
2. Wrong fingerprint and out-of-order ACK are refused, with a later stale-base edit still pending.
3. Injected failure before commit preserves empty ledger, old server revision and pending outbox even after a file reopen.
4. Delete tombstone survives the ACK; the ledger remembers its ID and rejects a divergent replay.
5. Two fictional profiles may use the same mutation ID without cross-profile updates.
6. Explicit v2 opening rejects the original v1 file and a wrong encryption key; invalid result values never produce a ledger entry.

**These six Rust tests have not been compiled/executed**: `cargo` and `rustc` are unavailable in the current execution environment. The other 23 Rust test definitions on this stacked branch also remain unverified. Rust format, Clippy, SQLCipher native library linkage, Windows PowerShell execution, persistence/ciphertext validation and exact native ACK hashes all require separate validation.

## Reference tests actually executed

With Node.js **22.16.0** and standalone synthetic reference files available in the workspace, ran:

```powershell
node --experimental-sqlite --experimental-strip-types --test tests/sqlite-ack-fp001-ledger.test.mjs
tsc --target es2022 --module nodenext --moduleResolution nodenext --lib es2022,dom --strict --noEmit --skipLibCheck contracts/sync/ack-fingerprint-001.ts
```

Result: **10/10 SQLite/TypeScript integration tests passed**, and the strict TypeScript typecheck passed. These tests verify a **plaintext temporary synthetic SQLite reference**, **not** Rust encryption or the newly written Rust native module. Existing Windows manual gate `crates/encrypted-outbox-spike/validate-windows.ps1` will include all new Rust tests automatically once the full SQLCipher toolchain is available.

## Open security and product blockers

- No proof yet that Rust builds, SQLCipher encryption works natively or Windows key management is correct. **Do not use any real subject records.**
- No authenticated server receipt, server-side idempotency or per-owner authorization has been implemented. A supplied digest cannot authenticate a server or user.
- This v2 writer processes **already queued v1 synthetic mutations after explicit v1→v2 migration**; it does **not** enable new v2 editing. A separate, reviewed v2 enqueue/rebase/conflict resolution workflow is required before claiming complete offline sync.
- The **ACK-FP-001 contract is intentionally ASCII/integer/synthetic-only** and cannot encode accented names or decimal astrological positions. A reviewed Unicode/number-safe successor is required before working with real charts.
- Reviewed locked native dependency tree, encrypted backup/restore, schema migrations with process termination, crash recovery, OS-bound secret management (Windows DPAPI/Credential Manager, macOS Keychain), key rotation and app authorization must precede any Tauri IPC integration.
- Schema v1 contains no historical ACK ledger. A migration cannot reconstruct IDs already acknowledged and removed in v1; server-side idempotency policy must cover that gap.
- No automatic GitHub Actions, merges to main, production updates, deploys, publication, licensing decisions or releases in this PR.

## Manual verification on Windows 11

From an isolated checkout of the branch, after installing the reviewed Rust MSVC, C++ and SQLCipher/OpenSSL build prerequisites:

```powershell
powershell -NoProfile -File .\crates\encrypted-outbox-spike\validate-windows.ps1
```

Generate and audit the standalone `Cargo.lock`, and rerun Rust tests with `--locked`; the script deliberately signals NOT READY without the reviewed lockfile. Do not connect the crate to Tauri until the full native validation succeeds.
