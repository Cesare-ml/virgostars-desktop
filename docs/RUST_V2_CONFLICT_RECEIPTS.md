# SQLCipher v2 conflict receipts — synthetic preservation gate

**Status: SOURCE PROTOTYPE / NOT NATIVE-TESTED.** This document and the new module live on a draft branch stacked on PR #25. The private VirgoStars Desktop application has not been connected to this component. This is not an authorization to use real charts, birth records, accounts or cloud receipts.

## What this increment does

`crates/encrypted-outbox-spike/src/ack_v2_conflicts.rs` adds two **synthetic-only** methods:

- `record_synthetic_v2_conflict(profile, mutation, expected_fingerprint, remote_revision, fail_before_commit)` transitions an eligible pending mutation to `state='conflict'` with a recorded `conflict_server_revision` **without deleting or rewriting its local subject, tombstone, original outbox payload, pending ID, base revision or server revision**.
- `list_synthetic_v2_conflicts(profile, limit)` reports only `mutation_id`, `entity_id` and `remote_revision` in FIFO order, scoped to the fictional profile. It does not return payloads or decide whether local or remote data should win.

The recorder is explicitly opened under the v2 SQLCipher, integrity/HMAC, schema-catalogue and fictional-ID checks already developed in PRs #14–#25. For a new conflict it requires the oldest matching pending mutation for that entity, an unchanged base server revision, valid printable ASCII remote revision and **ACK-FP-001 fingerprint recomputed from the persisted outbox snapshot**. An identical repeated conflict receipt is idempotent; a different revision or fingerprint is rejected. An injected failure before commit rolls back the state transition.

The original v2 ACK writer refuses `state='conflict'`, and the v2 enqueue method rejects a new mutation of the same entity while a conflict remains. Edits to unrelated entities are not blocked. Existing v2 tables already contain `state` and `conflict_server_revision`, so **no new migration or destructive DDL** is needed for this slice.

**This is conflict recording and inspection, NOT conflict resolution.** The conflict remains stored and locally visible until a future, explicitly approved user decision. No automatic last-write-wins, rebase, remote overwrite or deletion of the original pending mutation is performed.

## Test evidence

`tests/sqlite-v2-conflict-gate.test.mjs` contains **7 new synthetic SQLite reference cases**:

1. Record conflict without changing local fictional payload or server revision.
2. Exact duplicate conflict replay; divergent revision refused.
3. Wrong fingerprint, unknown mutation and invalid revision fail closed.
4. An out-of-order pending mutation cannot claim a conflict ahead of an earlier edit.
5. Profile-specific, payload-free conflict metadata.
6. Transaction rollback and pending state preservation across file reopen.
7. Same-entity edits remain blocked while unrelated subjects can still be staged.

**Executed in this turn:** Node.js 22.16.0, `node --experimental-sqlite --experimental-strip-types --test tests/sqlite-v2-stage-reference.test.mjs tests/sqlite-v2-conflict-gate.test.mjs` → **17/17 passed**. Also passed the strict TypeScript typecheck for `contracts/sync/ack-fingerprint-001.ts`. The GitHub blob of the new suite is **`589e432b970d2e3e5fa7818f2838a3ba2a92aa29`**, which exactly matches the locally executed file; existing SQL/TypeScript source blob hashes were separately verified.

**Rust:** Six new native test functions are authored in `ack_v2_conflicts.rs`, covering the same behavior and encrypted reopen. They have **not been compiled or executed**: Cargo/rustc are unavailable in this environment. Native SQLCipher HMAC/ciphertext, Windows PowerShell script, Rust lint/format and Windows/macOS integration have not been validated.

## Critical trust boundaries

- An ACK-FP-001 SHA-256 hash proves only request consistency; **it does not authenticate a server**. The receipt must ultimately originate from an authorized per-user backend operation with an enforced revision precondition.
- The current ACK-FP-001 contract handles **synthetic ASCII/integer data only**, not international names or floating-point astrology coordinates. Never process real natal information with this prototype.
- Storing a conflict revision is not enough to resolve a conflict safely: a future explicit user-choice workflow must preserve both versions, use a **new unique mutation ID** for any rebased edit, and retain a durable disposition of the abandoned original ID. Otherwise historical replay could reintroduce a rejected edit.
- No historical ACK ledger can be reconstructed for mutations already removed by v1; server-side idempotency and reconciliation remain necessary.
- Before real use: reviewed Cargo.lock, successful Rust/SQLCipher native tests and crash/reopen proofs, encrypted backup/restore, Windows DPAPI or macOS Keychain key custody, server owner authentication/authorization, timestamp and Unicode/decimal-safe canonicalization, and UI controls for explicitly reviewing conflicts.

## Manual Windows developer gate

From a checkout containing this branch, after reviewed Rust MSVC/SQLCipher prerequisites:

```powershell
powershell -NoProfile -File .\crates\encrypted-outbox-spike\validate-windows.ps1
```

The script now includes the seven conflict tests in its synthetic Node suite and automatically discovers the new Rust tests under `cargo test`. It intentionally remains NOT READY if no reviewed `Cargo.lock` exists.

No merge to `main`, GitHub Actions, deployment, release, visibility/license change or real database modifications were made.
