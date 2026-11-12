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

New v3 schema Git blob:
`76ff889a22c72ad7d0ce2bce497b06318f5a6fe1`

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
