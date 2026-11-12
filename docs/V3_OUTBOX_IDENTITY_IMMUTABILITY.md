# SQLCipher v3 prototype: immutable queued mutation identity

**Status: synthetic-only DDL hardening, draft stacked on PR #41.**
No production migration, Tauri IPC, account access, cloud operation or
real birth record is changed or authorized by this document.

## Exact defect

The v3 schema originally added an insert trigger
`local_outbox_v3_reject_used_mutation_id` that prevents inserting a
mutation ID already present in the ACK ledger or conflict-decision
history. However SQLite **does not run INSERT triggers for UPDATE**.

A direct update to `local_outbox.mutation_id`, `profile_id`,
`entity_type` or `entity_id` could rename an existing queued intent,
reusing a previously ACKed or retired ID, or reparent it to a different
subject/profile while leaving the other table rows valid. The semantic
audit could detect certain contradictions after the fact, but a
**preventive database invariant** is safer.

## Change

`contracts/sqlite/0003_conflict_decisions.sql` now declares
`local_outbox_v3_identity_immutable`, a
`BEFORE UPDATE OF profile_id,mutation_id,entity_type,entity_id`
trigger on `local_outbox`. If any of these four persisted values
actually changes, SQLite aborts the statement.

Existing legitimate operations remain permitted:

- The v2 conflict recorder updates only `state` and
  `conflict_server_revision` before the v3 migration.
- The v3 keep-local writer retires the original with DELETE, inserts
  the replacement as a NEW ID and appends immutable decision history.
- Future explicit conflict state transitions can update `state` and
  `conflict_server_revision` without changing identity.
- A no-op identity UPDATE does not fail, because the trigger checks
  whether any identity field actually changed.

This is defense in depth only. Do not expose unrestricted SQL, assume
client-side SHA-256 authenticates a server or bypass account isolation.

## Schema compatibility — IMPORTANT

The new trigger changes the **exact v3 schema catalogue**. The Rust
`validate_schema_v3` method intentionally compares against the DDL
template and will reject an older v3 file without this trigger.
**Do not auto-upgrade an existing SQLCipher archive and do not deploy
this experimental DDL to real users.** Recreate fictional test files
after changing branches; any future real migration requires an
explicit versioned schema migration with rollback and backup testing.

Historical v3 schema Git blob:
`960f1894d0c592597451df779d4d3df783b0d140`

Intermediate v3 identity-only schema Git blob:
`76ff889a22c72ad7d0ce2bce497b06318f5a6fe1`

Current queued-request snapshot schema Git blob:
`2b2f4eba6007d16acd5abf78dd0749bb908a197d`

Earlier draft PR documentation and historical test evidence that cites
the old blob describes the pre-hardening contract; it should not be
mistaken for the current expected v3 schema of this child branch.

## Executed evidence

The exact new full-schema test file,
`tests/sqlite-v3-identity-immutability.test.mjs`, has **9/9 PASS**
on Node.js 22.16.0 and only uses fictional values. Its Git blob
matches byte-for-byte the locally executed file:
`c6d44b687d440fc232da6b7d186c49b87b8a503b`.

It covers ID rename, entity reparenting, profile reassignment,
type rewrite, permitted no-op identity update, permitted state
transition, existing ACK ID reuse, archived original ID resurrection
via UPDATE/INSERT, and preservation of foreign-key integrity.

The earlier read-only audit test that explicitly UPDATEs a queued
mutation ID was also corrected to expect the new **SQL-layer
rejection**, rather than merely relying on subsequent audit refusal.

An actual Node execution of a broader synthetic local reference
selection returned **42/42 PASS**:

```powershell
node --experimental-sqlite --test `
  tests/sqlite-v3-identity-immutability.test.mjs `
  tests/sqlite-v3-conflict-previews.test.mjs `
  tests/sqlite-v3-keyset-fullschema.test.mjs
```

The 42-test result also includes a separately located original
minimal keyset test (6) and latest-local-snapshot test (7), which
must be run explicitly in their corresponding checkout paths. The
three paths above alone contain **29 tests**.

The new Rust SQLCipher trigger regression is **authored but NOT
compiled or executed**. Rust/Cargo/rustfmt/Clippy are unavailable in
this environment and no Windows SQLCipher build, cipher integrity,
wrong-key test or crash recovery is claimed.

## Additional v3 request immutability

The reviewed identity trigger is now complemented by
`local_outbox_v3_request_snapshot_immutable`, which rejects changing
`operation`, `payload_json`, `base_server_revision`, or
`created_at_utc` after a queue row is persisted. The identity trigger
also covers `sequence` so a queued mutation cannot be reordered through
raw SQL. All comparisons of nullable request fields use SQLite's null-safe
`IS NOT` operator.

The identity trigger now runs on **every UPDATE**, not merely
`UPDATE OF sequence`. SQLite's `rowid`, `_rowid_` and `oid`
aliases are able to change an INTEGER PRIMARY KEY while bypassing
an `UPDATE OF sequence` trigger. Three independent regressions
prove these aliases are now rejected, without blocking normal
state transitions.

Only the mutable synchronization fields `state` and
`conflict_server_revision` can be updated in place. The legitimate
keep-local writer uses DELETE + INSERT of a distinct mutation ID.
This protects against *even internally consistent* silent request
rewrites (e.g., changing both a materialized local entity and its last
outbox payload). The semantic audit cannot independently authenticate
such a rewritten request if no immutable original is retained.

The new 17-test full-schema Node regression
`tests/sqlite-v3-request-immutability.test.mjs` passed **17/17** locally
using exact GitHub-matching DDL, including NULL-base transitions,
tombstones, payload changes, timestamp changes, direct FIFO and rowid-alias
tampering, no-op updates and legitimate conflict-state transitions. New schema blob:
`9efb366c420944ebc53f87f39ada69d04232c262`.
New reference-test blob:
`ba74fcf74bfcb0d153c21e8f73b19577dfbf0176`.

**This further changes the strict synthetic v3 catalogue.** Previous
prototype v3 files (including those produced by the earlier version of
PR #42) intentionally fail exact schema validation; do not silently
upgrade them or attempt to apply this to real users. Tests authored
in Rust remain uncompiled until Cargo/SQLCipher are available.

## INSERT OR REPLACE and deleted FIFO position safeguards

The UPDATE triggers alone are insufficient: SQLite `INSERT OR REPLACE`
deletes a conflicting queued row and inserts a new one without invoking
the ordinary UPDATE triggers. Against the previous v3 DDL, a real
plaintext SQLite experiment confirmed that this silently changed
`payload_json` under an active mutation ID; supplying the same
`sequence` with another mutation ID could also replace that row.

The v3 `local_outbox_v3_reject_used_mutation_id` BEFORE INSERT trigger
now also checks the **active local_outbox table** for either the same
`(profile_id,mutation_id)` or an explicit colliding `sequence`.
This prevents an `INSERT OR REPLACE` or UPSERT from sidestepping
the immutable queued request, while a genuinely new mutation ID
still appends normally and IDs remain scoped to their profile.

There was a related problem: after deleting a queued row, a caller
could explicitly insert a fresh mutation at that **historically used**
FIFO number, causing subsequent keyset pages to miss it. The new
`local_outbox_v3_fifo_must_advance` AFTER INSERT trigger rejects
nonpositive sequences or a sequence at/below the retained
`sqlite_sequence` high-water mark. At AFTER INSERT time SQLite
still exposes the previous high-water mark; a normal implicit
AUTOINCREMENT insertion is higher and succeeds. A failed insertion
rolls back atomically. Explicit future sequence values above the
prior high-water remain permitted; this is a monotonicity check,
not a claim that SQL only accepts implicit rowid allocation.

**Actually executed:** the nine `INSERT OR REPLACE`/UPSERT tests and
four deleted-row sequence tests in
`tests/sqlite-v3-no-replace.test.mjs` passed **13/13** using the
real v1/v2/v3 SQL files. Combined with the prior 17 request-
immutability tests, the current schema passed **30/30** reference
tests with Node.js 22.16.0. The files on GitHub are byte-identical
to those tested locally:

- Current v3 DDL blob: `29d76af2cb1c4f263d494a852e7cb9ce5d5ae5a5`
- New 13-test blob: `5dd0d8a0a8c37f4c15c8526d114683eb4b915061`
- Prior 17-test blob: `ba74fcf74bfcb0d153c21e8f73b19577dfbf0176`

Two additional native Rust/SQLCipher test functions were authored
for active-row replacement and recycled FIFO positions, but remain
**uncompiled and unexecuted** without Cargo/rustc. The 30-test result
does not establish native SQLCipher encryption, Windows recovery,
production safety, or a complete test pass across all stacked PRs.

The strict v3 catalogue changes again. Previously created fictional
v3 encrypted archives must fail closed until a reviewed explicit
versioned migration or test-fixture recreation exists; never
silently rewrite or open real customer databases with this prototype.

## Immutable history and SQLite REPLACE semantics

The prior v3 history triggers reject direct `UPDATE` and `DELETE`
against `local_conflict_decisions`, but SQLite's default
`recursive_triggers=OFF` means an `INSERT OR REPLACE` can delete a
conflicting history row **without firing the DELETE trigger**. This
was reproduced against the actual fictional v3 schema: a replacement
changed an archived fingerprint and remote revision while preserving
SQL constraints.

The additional `local_conflict_decisions_no_replace` **BEFORE INSERT**
trigger rejects collisions on either the
`(profile_id,original_mutation_id)` key or the
`(profile_id,replacement_mutation_id)` unique key. Genuine new,
nonconflicting decisions still insert, including the same fictional
IDs under different profiles.

Eight further full-schema Node SQLite regressions passed **8/8**,
covering replacement by original and replacement keys, changed
fingerprints/revisions, identical replay, authorized new history
records, profile isolation, retained UPDATE/DELETE protections and
foreign-key integrity.

The current synthetic v3 source was tested together with the
13 queued-REPLACE/FIFO tests and the earlier 17 snapshot tests:
**38/38 PASS** (Node.js 22.16.0, plaintext SQLite reference).
The exact GitHub blob hashes match the locally tested sources:

- Current v3 DDL: `1f86d878ffb6f36349f9de4dfa009d5d441bff4b`
- Decision-history regression: `c03f71336fe6fa53b604dc7eed3816b4e66e570f`
- Queue-replacement/FIFO regression: `5dd0d8a0a8c37f4c15c8526d114683eb4b915061`

The native Rust history-replacement test is written but **has not
been compiled or executed**. The current schema hash supersedes all
earlier v3 hashes in this document. Any older synthetic v3 file
must fail strict schema checks until explicitly recreated or migrated.

**Still not production-ready:** the synthetic ACK ledger and receipt
trust model require separate immutability, per-account authorization,
key custody, signature/receipt verification and migration review.
This guard does not authenticate a server.

## Immutable acknowledged receipts (v3)

A final check of the existing v3 schema exposed a separate issue:
`local_ack_ledger` could still be rewritten with `UPDATE`, deleted,
or replaced by `INSERT OR REPLACE`. These operations were **actually
reproduced** against the exact v3 SQL schema before the fix. This
ledger remembers accepted mutation IDs and original request digests;
removing or changing a receipt defeats replay/retirement tracking.

Three additional **v3-only** SQL triggers now enforce:
- `local_ack_ledger_v3_no_update`: no ACK row rewrites, including
  fingerprint, revision, timestamp, subject and ownership.
- `local_ack_ledger_v3_no_delete`: no ACK removal from the synthetic
  archive.
- `local_ack_ledger_v3_no_replace`: an INSERT that collides with an
  existing `(profile_id, mutation_id)` is refused *before* SQLite
  could perform destructive OR REPLACE, even when the new contents
  happen to match the stored receipt.

Fresh distinct ACKs still insert, and the same fictional mutation
ID remains valid under a **different** fictional profile. These
triggers only exist after the v2→v3 schema migration: v2 ledger
behavior remains unchanged. ACK hashing remains a consistency check
and **not proof of remote server authenticity**.

`tests/sqlite-v3-ack-immutability.test.mjs` contains 12 independent
fictional full-schema cases for UPDATE, DELETE, REPLACE, conflict
UPSERT, fresh ACKs, per-profile isolation, v2-only compatibility,
outbox reuse refusal and foreign-key integrity.

**Actually executed locally:** all three prior immutable-queue/history
Node reference suites (38 tests) plus the new ACK tests (12) on
Node.js 22.16.0, totaling **50/50 PASS**. Every suite uses the actual
versioned v1→v2→v3 SQLite SQL files, plaintext fictional records
only. Byte-for-byte GitHub readback hashes:

- **Current final v3 DDL**:
  `6f6fb6581bcd92e8266bdf803ffedee2102d727b`
- New 12-test ACK suite:
  `4ab101a820447a7d7a2a3eafc6eda43855f162b5`
- Prior full-schema request tests (17):
  `ba74fcf74bfcb0d153c21e8f73b19577dfbf0176`
- Prior outbox REPLACE/FIFO tests (13):
  `5dd0d8a0a8c37f4c15c8526d114683eb4b915061`
- Prior conflict-history REPLACE tests (8):
  `c03f71336fe6fa53b604dc7eed3816b4e66e570f`

A native Rust/SQLCipher unit test was **authored, NOT compiled or run**.
The old native ACK-rewrite test was updated to expect a SQL error
instead of assuming it could tamper with the ledger. The entire
native suite still needs Windows Rust/SQLCipher validation.

**Compatibility:** older synthetic v3 files with missing triggers
are intentionally rejected by exact schema validation; no silent
migration. An explicit reviewed, versioned migration and rollback
plan is required before any eventual real-user release.

## Required review gates

1. Consolidate stacked PRs and rerun **all** Node suites with the new
   schema and the adjusted v3 audit test.
2. Review the modified v3 schema hash and the pre-existing test-only
   database compatibility boundary.
3. On Windows with a reviewed Cargo.lock and native SQLCipher toolchain,
   run the existing `crates/encrypted-outbox-spike/validate-windows.ps1`.
   Verify migration, exact schema checks, wrong-key refusal, crash
   recovery, outbox immutability, native backup/restore and the full
   v3 Rust test module.
4. Do not add Tauri IPC or real user data until authentication,
   ownership, OS key custody and Unicode/decimal-safe request
   canonicalization are reviewed.

This branch does not modify the manual Windows gate, already being
edited in sibling backup PR #35. No GitHub Actions, main merge,
production, deployment, release, license or visibility changes.
