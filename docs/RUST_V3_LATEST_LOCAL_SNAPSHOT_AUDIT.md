# SQLCipher v3 audit — latest queued vs materialized subject

**Status: synthetic-only Rust source prototype, stacked on draft PR #36.**
Not integrated into VirgoStars Desktop, an authenticated server, production,
real birth records, or automatic data repair.

## Problem addressed

The v3 semantic audit already validates individual queued mutation
fingerprints, conflict states, ACK overlap and immutable decision history.
However, a fictional local subject could be silently modified without
recording a corresponding new offline mutation: each *outbox* row would
remain valid, but the actual *local_entities* payload or deletion flag
would differ from the latest edit to synchronize.

## Code change

`crates/encrypted-outbox-spike/src/ack_v3_audit.rs` now checks, for
each fictional profile/entity combination with queued mutations, that:

- The **latest** queued mutation by durable autoincrement sequence is
  the one whose `payload_json` and `operation == delete` flag match
  the materialized `local_entities.payload_json` and
  `local_entities.locally_deleted` exactly.
- Earlier pending or conflicted FIFO mutations may legitimately contain
  different payloads; only the **last** one must represent the current
  local view. This avoids flagging normal multiple-edit offline work.
- Profiles and entities are handled independently using SQL bound
  parameters, inside the existing read-only DEFERRED transaction.
- Any mismatch returns the existing generic fail-closed error; the
  audit does not repair, overwrite, delete, export or log content.

The audit deliberately does **not** require the latest outbox
`base_server_revision` to equal the materialized server revision:
a prior ACK may have advanced that revision while a dependent queued
operation remains pending and requires conflict handling.

## Verification

Three **Rust unit tests authored but NOT compiled/executed**:
unrecorded local payload change, inconsistent local tombstone, and
legitimate two-edit FIFO where only the last matches the local view.

`tests/sqlite-v3-latest-local-snapshot.test.mjs` is a small separate
synthetic SQLite reference that mirrors the same query/compare logic:
7/7 tests **actually PASS** with Node.js 22.16.0, run twice. Cases
include valid upsert; untracked payload change; tombstone mismatch;
legitimate multiple edits; outdated local view; valid delete; profile
isolation. This test uses a deliberately minimal plaintext reference
schema, **not** the full SQLCipher v3 archive or the Rust native API.

Exact Git blob of the executed file, independently confirmed on GitHub:
`19e87eb814f3321e560d155262dd72319dfb82cd`.

Run from the repository root:

```powershell
node --experimental-sqlite --test tests/sqlite-v3-latest-local-snapshot.test.mjs
```

No local Cargo, rustc, rustfmt or SQLCipher build toolchain was available.
No native test pass, encrypted backup/restore or Windows executable is
claimed. This is a code/test increment awaiting native verification.

## Additional limitations

The narrow ACK-FP-001 format remains restricted to fictional ASCII and
safe integers; it is unsuitable for real Unicode names and decimal
astrological positions. An outbox consistency digest is not proof of
server authentication, authorized ownership, or accurate astronomical
results.

The existing Windows manual validation script is NOT modified by this
branch because independent draft PR #35 already modifies that script
for the encrypted backup drill. Add this explicit Node command to the
eventual consolidated manual gate after dependency review.

**No main merge, GitHub Actions, production, deploy, release, license or
visibility change.**
