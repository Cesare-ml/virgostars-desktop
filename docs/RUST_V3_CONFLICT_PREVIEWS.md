# SQLCipher v3 conflict previews — synthetic-only Rust prototype

**State: draft / source prototype.** This module is stacked on PR #37 in the
private VirgoStars Desktop repository. It is not connected to Tauri, real
accounts, authenticated server receipts, production or personal astrology
records. Do not expose its internal fingerprint over a WebView or cloud API.

## Why this slice

The existing fictional SQLCipher v2 implementation has a limited conflict
listing, but v2-only operations are intentionally rejected after the explicit
v2-to-v3 migration. PR #31 added a v3 keep-local decision writer, which needs
a persisted original mutation ID and the exact request fingerprint. This
change supplies **read-only inspection for v3**, without attempting remote
acceptance, resolution, auto-merge or user impersonation.

## Rust method

`SyntheticEncryptedStore::list_synthetic_v3_conflict_previews(profile, limit)`
returns at most 100 `SyntheticV3ConflictPreview` records, in durable
`local_outbox.sequence` order, only for the specified fictional profile.

Each preview contains:
- `mutation_id` and `entity_id` (fictional identifiers only).
- `remote_revision` from the already-recorded conflict.
- `original_fingerprint`: ACK-FP-001 SHA-256 calculated from the *persisted*
  original mutation, not a caller-supplied payload. This digest is a
  consistency token, NOT server authorization or a safe user-session token.
- `can_keep_local`: advisory hint, true only when exactly one mutation is
  queued for that profile/entity AND the materialized local payload,
  tombstone flag, and original server base all match the saved conflict.

The method refuses invalid fictional IDs, limits outside 1..100,
non-v3 schemas, corrupt or noncanonical original mutations and invalid
conflict revision strings. It uses a single DEFERRED snapshot transaction,
rechecks the exact v3 schema and synthetic-row constraints, and never
writes, repairs, deletes, uploads or renders a subject's payload.

**This hint does not authorize a write.** The Rust v3 keep-local writer
must independently redo all preconditions inside its IMMEDIATE
transaction. Any local changes between the preview and a later decision
must be rejected by that writer.

## Evidence

**Native Rust: 7 unit tests authored, NOT compiled or executed**, covering
profile isolation; FIFO order; digest reconstruction; safe/unsafe keep-local
hints; dependent edits; changed materialized payload; fictional delete
tombstones; invalid limit/profile/v2 schema; corrupted fractional data; and
encrypted file reopen. The current execution environment does not contain
Cargo/rustc and no SQLCipher native test pass is claimed.

**Actually executed on Node.js 22.16.0: 10/10 tests PASS**, twice.
`tests/sqlite-v3-conflict-previews.test.mjs` runs the independent preview
algorithm against the *exact* repository SQL schemas v1, v2 and v3
with temporary plaintext synthetic records. Their Git object IDs were
verified against the private repo:

- v1 `013b80914fb2fc1bbb66ff266e7f7a069b96e794`
- v2 `306e343ff3f8e3e9637ee4111379ea5b8527c699`
- v3 `960f1894d0c592597451df779d4d3df783b0d140`

The test source on GitHub is byte-identical to the local executed test,
with blob `0f8c65af26c476549cf196e0bb3413898f12e737`.

To reproduce the Node reference from this branch:

```powershell
node --experimental-sqlite --test tests/sqlite-v3-conflict-previews.test.mjs
```

The manual Windows gate will eventually need this reference included
after consolidation with sibling draft PR #35, which already edits
`validate-windows.ps1`. This PR deliberately does not modify that shared
script to minimize parallel agent conflicts.

## Privacy and future integration requirements

A SHA-256 hash of low-entropy fictional payloads can expose equality or
support guessing if incorrectly shared. **Do not expose this digest via
unauthorized IPC, logs or cloud.** Use a separately reviewed backend
authorization and per-profile/device capability model before any UI.

Support for real Unicode birth names, decimal longitudes and timestamps
requires a new reviewed version of the intentionally restricted
ACK-FP-001 protocol. For production, also require Windows MSVC native
SQLCipher tests, OS-keystore key management, authenticated receipts,
secure backup/restore and review of large-archive audit performance.

This is a **prototype**, not a released desktop feature. No GitHub Actions,
main merge, production deployment, personal data, licensing or repo
visibility changes occurred.
