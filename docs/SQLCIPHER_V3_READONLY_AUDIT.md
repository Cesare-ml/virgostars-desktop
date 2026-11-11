# Synthetic-only SQLCipher v3 read-only semantic integrity audit

**State: DRAFT / isolated source prototype. Not connected to Tauri,
accounts, production or a real user database.**

The existing v3 opening gate checks SQLCipher HMAC/pages, exact schema
catalogue, foreign keys and synthetic identifiers. SQL can still satisfy
those checks while containing contradictory outbox, ACK and archived
conflict-decision records. This module adds a non-destructive semantic
audit before any future backup/restore or synchronization adoption.

## Native source

New module: crates/encrypted-outbox-spike/src/ack_v3_audit.rs

Public method:

    SyntheticEncryptedStore::audit_synthetic_v3_readonly(&mut self)
        -> Result<SyntheticV3AuditSummary>

The audit uses a single deferred snapshot transaction and performs
**no INSERT, UPDATE, DELETE, migration, repair, export or backup**.
The summary has only three integer counts: outbox, acknowledged and
archived decision rows. No subject data, names, identifiers, keys or
paths are returned or logged.

It fails closed if:

- Pending and conflicted outbox rows have inconsistent state/revision,
  cannot be canonicalized as fictional ACK-FP-001 requests, or overlap
  an ACK or previously retired original mutation ID.
- ACK rows are non-synthetic or share an ID with an outbox mutation.
- Archived original payload/ID/base/time cannot reconstruct its
  **exact versioned SHA-256** or its retired ID is still queued/ACKed.
- A recorded replacement ID has no current queue, ACK or subsequent
  explicit decision; a queued replacement disagrees with operation,
  entity, payload, new base or timestamp in immutable history.
- An ACKed replacement references a different subject, or a chained
  decision cannot be matched to its predecessor's exact replacement.
- Any scanned table contains **more than 10,000 rows** (prototype
  hard limit, not a production scalability design).

An audit success does **not** prove a remote server was authenticated
or a backup can be restored. A SHA-256 fingerprint proves consistency,
not authorization.

## Validation evidence

Eight Rust unit tests have been authored, including successful
conflict/history audit, encrypted reopen after keep-local, bad archived
hash, unsupported decimal payload, simultaneous ACK/pending ID,
ACKed+retired original ID, wrong-subject replacement ACK and v2 refusal.
**None have been compiled/executed here**: Cargo/rustc are unavailable.

The independent reference is:
tests/sqlite-v3-readonly-audit.test.mjs

With Node 22.16.0 and temporary **plaintext** SQLite, **12/12 tests
actually passed** (including forged history, orphan replacements, wrong
base/ACK entity, retired ID reuse, and audit limit). The exact test file
run locally matches the GitHub Git blob:
95567a5c850567c158cc9bdc3049340c8139e47f

The test uses exact v1/v2/v3 schema files, verified byte-for-byte:
- v1: 013b80914fb2fc1bbb66ff266e7f7a069b96e794
- v2: 306e343ff3f8e3e9637ee4111379ea5b8527c699
- v3: 960f1894d0c592597451df779d4d3df783b0d140

The Windows manual validation script now includes these Node tests;
it also runs Rust unit tests when a reviewed toolchain exists.

## Required before any real archive recovery

Run Cargo fmt, clippy and tests against the reviewed SQLCipher/OpenSSL
dependency lock on Windows MSVC. Verify ciphertext, HMAC, wrong-key
refusal, crash recovery, encrypted backups and restoring into a new
isolated location. Add DPAPI/Keychain protected keys and authenticated
server receipts. Replace synthetic ASCII/integer-only ACK-FP-001 before
real birth names or decimal astrology coordinates are supported.

No main merge, GitHub Actions, deployment, release, real records,
license change or repository visibility change.
