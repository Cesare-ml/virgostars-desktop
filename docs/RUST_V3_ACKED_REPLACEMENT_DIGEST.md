# Synthetic v3 ACKed replacement fingerprint audit

**Status: isolated draft storage hardening. NOT production sync, Tauri IPC, a
SQLCipher release or a live authorization check.** Stacked on PR #33.

## Defect and correction

The v3 read-only semantic audit reconstructed the archived original request
and verified its ACK-FP-001 SHA-256. For a replacement that was **already
ACKnowledged**, it checked only the ACK entity type and entity ID. A forged
or inconsistent ACK row could therefore point to the correct fictional
subject yet represent a different payload, base revision, timestamp or
mutation while incorrectly passing the audit.

The new native check in
`crates/encrypted-outbox-spike/src/ack_v3_audit.rs` derives an exact
replacement from the **archived original**: preserve subject, entity type,
operation and payload; substitute the immutable replacement mutation ID,
the recorded conflict remote revision as new `baseRevision`, and the
decision timestamp as new `createdAt`. It recomputes the versioned
ACK-FP-001 fingerprint with the existing Rust canonicalizer, then demands
that the stored `local_ack_ledger.request_fingerprint` match it exactly.

Both the original subject check **and** the replacement digest must agree.
An unrelated receipt, mismatched payload, stale base, altered timestamp,
or malformed canonical request now fails closed. Only the isolated v3 audit
is changed; nothing is auto-repaired or deleted.

The Rust unit test
`acked_replacement_requires_exact_fingerprint_from_archived_request`
constructs a successful same-subject ACK for the expected replacement and
then alters its stored SHA-256 to verify audit rejection.

## Reference tests

- The shared `tests/sqlite-v3-readonly-audit.test.mjs` has been updated:
  a formerly accepted placeholder SHA of `aaaa...` is replaced with the
  **actual canonical digest** for the fictional archived replacement.
  A new negative case refuses an ACK with the right subject but a
  different payload fingerprint.
- The independent test
  `tests/v3-acked-replacement-fingerprint-reference.test.mjs` exercises
  exactly this digest invariant with a minimal ephemeral Node SQLite
  model: valid receipt, wrong payload, stale base, wrong timestamp and
  wrong entity. **5/5 PASS locally on Node.js 22.16.0.**
- The independent test Git blob from GitHub matches the exact local
  executed source: `ee0627e2a444e9a7d0b8d4f04892eaab1f8345ab`.
- The independently constructed minimal test is **not** the full v3
  database schema, not a cryptographic identity proof and not a
  substitute for the existing end-to-end reference suite. The updated
  13-test main v3 reference and new Rust unit test have **not** been
  executed in this authoring environment.

## Required native validation

A reviewer with Windows 11, Rust MSVC and a reviewed SQLCipher build
must run the full synthetic native gate and particularly confirm that
a genuine encrypted v3 file is rejected when its ACK ledger fingerprint
has been changed without altering its subject ID. Include wrong-key,
HMAC, crash/reopen, backup/restore and revocation tests before any real
app integration.

ACK-FP-001 is ASCII/integer/synthetic-only; it cannot encode real
international names or decimal astrological positions. SHA-256 is
**request consistency, not server authentication**. An authorized
VirgoStars backend must independently verify the owner, remote revision,
device, receipt and idempotency record.

This branch does not modify the Windows manual validation script because
separate draft PR #35 already edits that script for the encrypted backup
drill; the new standalone Node test may be invoked explicitly with:

    node --experimental-sqlite --test tests/v3-acked-replacement-fingerprint-reference.test.mjs

No main merge, GitHub Actions, deploy, real data, new license, public
visibility or production changes.
