# Rust SQLCipher v2 enqueue — synthetic-only stage 009

**Status:** source prototype, draft PR stacked on #24. Nothing in this slice is a released or authorized personal-data store. The private desktop repository and its licensing status remain unchanged. The source is not linked to Tauri IPC or the VirgoStars server.

## What was implemented

`crates/encrypted-outbox-spike/src/ack_v2_stage.rs` adds
`SyntheticEncryptedStore::stage_synthetic_v2_mutation(&AckRequest, fail_before_commit)`.

- Requires an explicit existing v2 store and **reuses the native SQLCipher schema/HMAC checks** implemented in draft PRs #14–#24. This method will not create or migrate a database and will not create new profiles; the synthetic profile must already be staged in v1 before the explicit test migration.
- Uses the same **ACK-FP-001** typed request and Rust SHA-256 reference as the existing v2 acknowledgement writer. Unsupported Unicode, decimal values, non-synthetic identifiers, invalid operation/nullable-payload combinations and oversized envelopes fail closed. These restrictions make it **unsuitable for real astrological profiles**.
- Within `BEGIN IMMEDIATE`, checks the `local_ack_ledger` for the scoped ID. An exact previously acknowledged request returns `AlreadyAcknowledged` without changing the entity. A different request with the same already ACKed ID is rejected. Any ID already present in the pending/conflicted outbox is rejected (including byte-identical duplicate enqueue).
- Confirms that the fictional profile exists, that `baseRevision` matches the current server revision, and that no same-entity pending row is already conflicted or based on a **stale** server revision. Other entities and other profiles remain independent.
- Commits the entity edit (or tombstone) and immutable `local_outbox` mutation in **one encrypted SQLite transaction**. Immediately reads back the stored row, reconstructs the ACK-FP-001 request from the persisted payload/base/time and compares the fingerprint to the staged request. A mismatch aborts the entire transaction.
- A test-only `fail_before_commit` parameter injects an error that must roll back the new local entity and outbox mutation together. There are no network calls or server-issued receipts here.
- Eight additional **authored but unexecuted** Rust unit tests cover v2 stage+ACK close/reopen, pending ID reuse, acknowledged ID reuse, stale edit/conflict isolation, rollback/reopen, delete tombstone, profile scope, unsupported data and missing profiles.

This follows PR #24's **synthetic accepted-receipt writer**; it does not implement conflict resolution/rebase, edits to already conflicted entities, real cloud authentication, token management, real local device identities, or authenticated sync.

## Executed SQLite reference verification

A matching plaintext/fictional reference is committed as
`tests/sqlite-v2-stage-reference.test.mjs`.

From the repository root:

```powershell
node --experimental-sqlite --experimental-strip-types --test tests/sqlite-v2-stage-reference.test.mjs
```

**Actually executed with Node 22.16.0: 10/10 PASS.**

The GitHub test blob is `8cc368e385884d972654986bc753c5e0042d2f16`, exactly matching the file run locally. The test uses checked-in v1/v2 SQL schemas with verified blobs `013b80914fb2fc1bbb66ff266e7f7a069b96e794` / `306e343ff3f8e3e9637ee4111379ea5b8527c699`, and the **exact exported TypeScript ACK-FP-001 module** blob `10df48f21449e5d9195b46014b3f94b5f46c6cb2`. The test runner uses **temporary plaintext** SQLite exclusively with fictional subject values; the real Rust/SQLCipher code has **not** been exercised by these Node tests.

The Windows manual `crates/encrypted-outbox-spike/validate-windows.ps1` includes the new reference. Its native Cargo section automatically includes the eight new unit tests.

## Must pass before any real use

1. **Compile all Rust/SQLCipher code**, run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --locked` with reviewed `Cargo.lock`, and validate the compiled Rust ACK-FP-001 golden values. There is no Rust toolchain available in this authoring environment: **no Rust test result is claimed**.
2. Confirm native ciphertext pages, HMAC/version, wrong keys, cross-profile isolation, encrypted restart, locks and crash rollback on Windows 11; perform a disk backup/restore drill on synthetic samples.
3. Approve Unicode and floating-point-safe request canonicalization for real birth records, astronomical positions and cities. This ASCII-only prototype intentionally rejects such data.
4. Define authenticated server-side per-user authorization, idempotent receipts, server revision preconditions, remote change pagination/cursors, conflict resolution/rebase and deletion retention. A local SHA-256 is a consistency fingerprint **not authentication**.
5. Implement secure OS-bound account key management, recovery and signed release pipeline only after architecture review. Never copy live birth data, credentials or tokens into a test fixture.

No changes to `main`, production, hosting, GitHub Actions, repository visibility, license or release channels.
