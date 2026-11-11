# v3 conflict decision ledger and “keep local” reference — synthetic only

**Status: prototype; draft branch stacked on PR #28.** This is NOT a Tauri interface, production schema upgrade, authenticated VirgoStars synchronization, approved user-data store or complete automatic conflict resolution.

## The actual capability

This increment deliberately supports exactly **one user-directed resolution choice**: **keep the existing local fictional edit and queue it under a NEW mutation ID with the conflicting remote revision as its new base**. It is not a last-write-wins merge, remote acceptance or a guarantee that the next push will succeed.

The original `local_outbox` record is no longer pending after the decision, but its **entire original synthetic payload, operation, base revision, timestamp, original ID, fingerprint and remote conflict revision** remain in the new `local_conflict_decisions` history table. It also remembers the replacement mutation ID and the decision time. Never silently discard a subject's offline work.

The original conflict must already be recorded through the preceding v2 conflict workflow; the remote revision must ultimately be authenticated and owner-authorized by the real backend, **which does not yet exist**. An untrusted SHA-256 hash is only a consistency check, not receipt authentication.

### Migration and SQL guard

`contracts/sqlite/0003_conflict_decisions.sql` adds the history table, a profile/entity lookup index and a trigger. The trigger refuses a raw new outbox row with an **already ACKed ID** or an **original/replacement ID already recorded in decision history**. This hardens the database even if a future caller bypasses the application enqueue method.

`PRAGMA user_version=3` is applied ONLY through an explicit `BEGIN IMMEDIATE` migration after a verified schema v2, FK integrity and synthetic-ID gate. A failed migration rolls back all new DDL and leaves the v2 database usable. The normal Rust v1/v2 constructors still **refuse v3**.

`crates/encrypted-outbox-spike/src/lib.rs` now additionally contains `validate_schema_v3`, `open_synthetic_v3`, `migrate_synthetic_v2_to_v3` and two authored Rust tests for explicit migration, durable reopen, failed version mismatch and rollback. The Rust migration applies the same full SQL catalogue and foreign-key gate used by earlier versions. **It does not yet implement the keep-local decision writer** in Rust. Native Rust/SQLCipher has not been compiled or executed here.

### Critical transaction ordering

`tests/sqlite-v3-manual-keep-local.test.mjs` implements and tests the explicit **synthetic-only** decision reference. It reconstructs the ACK-FP-001 fingerprint from the **persisted old outbox snapshot** and compares with the expected hash before taking the SQLite lock; after `BEGIN IMMEDIATE` it verifies the persisted row has not changed. A decision is allowed only if:

- The existing row is already in `conflict` with a recorded remote revision;
- No other pending mutation exists for that same entity (otherwise user review is mandatory);
- The local entity still contains the exact conflicted payload/tombstone and base revision;
- The replacement ID is new, profile-scoped and not present in outbox, ACK ledger, original decision IDs or replacement IDs;
- The new versioned request passes the strict fictional-only ACK-FP-001 canonicalizer.

**Atomic order is essential:** delete the old outbox row → set the fictional entity's base server revision to the conflict revision → insert the replacement pending mutation → **insert immutable decision history LAST** → commit. An initial test exposed a trigger failure when the history was inserted before the new outbox row: the trigger correctly rejected the new ID as already used. This ordering ensures the initial replacement is allowed, while the committed history permanently reserves both IDs thereafter. Any failure rolls all steps back.

The test model does not accept a new editable payload at decision time, never changes the user's existing fictional local contents, and never chooses a remote winner on the user's behalf.

## Executed verification

From the repository root with Node >=22.16:

```powershell
node --experimental-sqlite --experimental-strip-types --test tests/sqlite-v3-manual-keep-local.test.mjs
```

**Executed in the authoring environment, Node 22.16.0: 11/11 PASS.** Cases cover explicit migration, failed migration rollback, preservation of full original content/new ID, idempotent same decision and refusal of inconsistent replays, invalid hashes/IDs, multiple pending dependents, changed local entity, atomic rollback, raw SQL ID-resurrection refusal, close/reopen persistence, and separation of two fictional profiles.

Exact tested Git blobs:
- `contracts/sqlite/0003_conflict_decisions.sql`: `5d4470173079110f5685f32c509acaea29ac6fbf`
- `tests/sqlite-v3-manual-keep-local.test.mjs`: `fc8c6d96918158e1ecd4ea6a35f8376927d779dc`

The tests use **temporary plaintext Node SQLite with fictional input**, not SQLCipher encryption, Rust or live VirgoStars accounts. The manual Windows validation script now also includes this suite.

## Blocking tasks before real use

1. Compile/test Rust with a reviewed Cargo.lock, genuine SQLCipher HMAC verification, Windows MSVC and encrypted reopen/rollback, backed-up migration validation.
2. Implement the **native v3 keep-local decision writer** with equivalent test vectors; v2 writer/enqueue/ACK methods must continue rejecting v3 until native v3 runtime is reviewed.
3. Support **accept remote version** only after a trusted, owner-scoped and version-checked remote snapshot is available. Preserve both versions and any explicit user decision. Neither browser trust nor a hash can replace backend authorization.
4. Design a Unicode/decimal-compatible successor to the deliberately restricted ASCII-only ACK-FP-001 protocol for actual astrological and international birth details.
5. Add OS-protected keys (DPAPI/Keychain), encrypted backup/restore, signing and reproducible manual Windows tests before wiring into Tauri.
6. Plan archival retention, migrated old v1 ACK IDs (historically unrecoverable locally), and durable server idempotency windows.

No real data was migrated, no main merge, GitHub Actions, deployment, licensing change, release or publicity change occurred.
