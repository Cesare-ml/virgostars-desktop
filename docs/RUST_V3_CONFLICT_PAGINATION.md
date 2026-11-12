# SQLCipher v3 conflict previews: bounded keyset pagination

**Status: source prototype / draft stacked on PR #38. Synthetic-only.**
This does not enable Tauri IPC, authenticated accounts, server sync,
production birth records or automatic conflict resolution.

## Reason for this increment

The previous `list_synthetic_v3_conflict_previews(profile, limit)` returned
only the earliest 100 conflicted mutations. A client had no way to
request the next batch. Increasing the maximum would create a
potentially unbounded metadata view and slow the UI.

This increment adds a **FIFO keyset cursor**, leaving the legacy
three-argument-free listing method's original two-parameter signature
unchanged:

- `page_synthetic_v3_conflict_previews(profile, after_sequence, limit)`
- Returns `SyntheticV3ConflictPage { items, next_after_sequence }`.
- `after_sequence=None` begins at the start of the profile's
  conflicted outbox. Otherwise use the **last returned** sequence as
  the cursor, never a client-controlled OFFSET.
- Only rows of the same fictional profile, type=subject and
  state=conflict, with `sequence > cursor`, may appear.
- `limit` remains 1..100. Query reads **at most limit+1** rows to
  determine whether a next page genuinely exists. The cursor is
  returned only when there are extra results; an exactly-full final
  page does not manufacture a next page.
- Cursor values are restricted to 0..9,007,199,254,740,991 (the
  largest exactly representable JavaScript integer); negative and
  unsafe cursors fail closed.
- The original v3 method delegates to the new method with a null
  cursor and returns only `items`, preserving its public API.

Every page still validates the **exact v3 schema and synthetic IDs**,
reconstructs each returned original mutation's fingerprint from
persisted content, checks conflict revisions, and computes the
conservative `can_keep_local` hint. No write is performed, and no
payload is returned in the preview structs.

## Important cursor semantics

A sequence cursor is **NOT** an authentication token and must not be
exposed over an unreviewed UI or API. The current preview fingerprint
must also remain internal: a SHA-256 hash over low-entropy names and
payloads can facilitate guessing.

Each page uses an independent DEFERRED consistent read transaction.
Across pages, new conflicts may be queued and earlier ones resolved,
so this is **not** a frozen multi-page database snapshot. The cursor
prevents replaying earlier FIFO IDs, but a conflict removed before its
page is read will not be listed. The native decision writer must
recheck all preconditions atomically when the user eventually acts.

## Verification evidence

Rust source has **10 unit tests authored** in the preview module
(previous seven plus three keyset cases: 2+1 pages and terminal
cursor; invalid/unsafe cursor and profile isolation; resolution of
an earlier conflict between page requests). **Not compiled or
executed here:** `cargo`, `rustc`, SQLCipher/Windows native tests
and Rust format/Clippy are unavailable.

A separate, intentionally small Node.js 22.16.0 plaintext SQLite
model was actually executed:

    node --experimental-sqlite --test tests/sqlite-v3-keyset-pagination.test.mjs

**6/6 PASS.** Cases: 2+1 FIFO pages; full final page; deletion of
a previous row between pages; cross-profile/pending filtering;
invalid cursor/limit; empty/end-of-table behavior.

The checked-in source is byte-for-byte identical to the executed
local file; Git **blob** ID:
`8839dc7c417acaa05f9560e2897cfb7e87b94bbe`.

The test uses minimal fictional SQLite DDL, **not** SQLCipher or the
full v3 schema. It tests the pagination invariant only. The earlier
v3 conflict preview tests use exact schema v1/v2/v3 reference files;
their result is not newly revalidated by this standalone test.

The separate draft backup PR #35 also modifies the shared Windows
manual test gate. To avoid a file conflict, this branch does **not**
change `validate-windows.ps1`; include this Node command when
consolidating the stacked draft PRs.

## Safety prerequisites

Before real desktop integration: native SQLCipher/MSVC compile/test,
reviewed Cargo.lock, real encryption/HMAC verification, OS-keystore
keys, authenticated owner-scoped access, validated remote revision
receipts, a Unicode/decimal-safe successor to fictional ACK-FP-001,
and explicit UX for conflicts with dependent local edits.

No production, main merge, GitHub Actions, release, deployment,
real personal data, license or repository visibility changes.
