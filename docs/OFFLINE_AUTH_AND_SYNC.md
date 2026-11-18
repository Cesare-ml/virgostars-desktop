# Offline authentication, account data and synchronization contract

Status: **IMPLEMENTED_ISOLATED** for the candidate described below. It is disabled
by default and has not been deployed or verified against production.

Product requirement clarified on 2026-11-18: the same account's natal-chart
groups should be available across Desktop and the website. This is not sharing
with other accounts. The candidate server read model contains group names, but
the guarded Desktop candidate imports the verified account's complete snapshot
into the encrypted archive, maintains native account-bound identities, and
periodically reconciles groups. Edits are recorded atomically for retry, require
separate group-write consent to upload, and expose concurrent conflicts for an
explicit choice. Missing remote charts retain their local copy and pending edits.
Notes are excluded. The most recently synchronized profile remains available
offline; selecting another account cannot expose or edit that profile. The
native server-provided profile reference never crosses IPC.

Imported civil data preserve unknown times without inventing an instant. A
known time is calculated only when its time zone resolves unambiguously; missing,
ambiguous or nonexistent local times require review. The snapshot is limited to
500 charts and each chart to 50 groups; unsupported snapshots fail without
truncation. The candidate creates a separate local copy for each remote identity.
The user can explicitly associate it with an existing local chart after reviewing
both; conflicting groups remain unresolved until the user chooses. Deleting the
local chart retains the imported record and its pending group state. A separately
consented creation queues an immutable encrypted payload and mutation ID before
network I/O; a retry is completed before importing a snapshot. Ambiguous civil
times and lossy subsecond values are refused. A definitive server rejection at
the 500-chart limit can be cancelled without deleting the local chart. A network
failure remains queued because the server may already have created the chart.
Browser production consent, deployment and real end-to-end
verification remain outstanding. The proposed journey and API below describe
the target, not capabilities proven in production.

## Required user journey
1. **First online login:** open trusted VirgoStars identity flow in the system browser using OAuth 2 Authorization Code + PKCE (or a rigorously reviewed desktop-safe equivalent). Register this installation with a per-device identifier; obtain only account-scoped privileges.
2. **Download initial snapshot:** after server authorization, import only the signed-in user's allowed entities into a local transaction. Protect keys with OS secure storage; show download/progress/retry.
3. **Offline startup:** if this device already established a verified session and policy permits local unlocking, open its previously downloaded encrypted profile. Calculations and writes should not need Internet.
4. **Offline edit:** write entity + outbox record in one local transaction. Show *Pending sync*, never falsely *Synced*.
5. **Reconnect:** refresh session if needed, push idempotent mutations and pull incremental changes. Support backoff, transient failures and resume after crash.
6. **Conflict:** detect concurrent edits, preserve both versions, offer user resolution when automatic field merge is unsafe. Never silently discard notes/birth-data edits.
7. **Logout / device loss:** local sign-out must securely clear local credentials and offer local-profile deletion; server-side device revocation prevents future sync, but cannot instantly revoke access to a physically offline encrypted copy.

## High-level state machine
```text
NEW_DEVICE -> ONLINE_LOGIN -> SNAPSHOT_PENDING -> READY_ONLINE
                                      |                 |
                                      v                 v
                                  READY_OFFLINE <--> RECONNECTING
                                      |                 |
                                  LOCAL_OUTBOX ---> SYNCING
                                                     |    |
                                                   CLEAN  CONFLICT
```

## Local-first data model (illustrative, not schema)
- `profile_id`, `device_id` and `user_id`: separate profiles and tenant scopes.
- Entity: `entity_type`, `entity_id`, `payload`, `server_revision`, `local_revision`, `deleted_at`.
- Outbox: `mutation_id` (globally unique and stable across retries), `entity_id`, `base_server_revision`, `operation`, `new_payload`, `created_at`, `status`.
- Cursor: server-provided opaque `sync_cursor`, updated only after durable application of an entire page of server changes.
- Preserve tombstones long enough to replicate deletions to all devices; never treat absent objects as safe deletes.

## Proposed versioned API (not available yet)
```text
POST /api/v1/desktop/devices                  register authorized installation
GET  /api/v1/desktop/sync?cursor=...          paginated owner-filtered changes
POST /api/v1/desktop/sync/mutations           idempotent batch with base revisions
POST /api/v1/desktop/devices/{id}/revoke      authenticated revocation
```
Paths and DTOs are illustrative. Backend owners must validate access and define contracts before implementation. Do not reuse or expose private routes from assumptions.

## Sync algorithm invariants
- Local commit + outbox insert happen together. A crash never creates a successful edit with no sync intent.
- Server applies a mutation at most once under unique `mutation_id`; retries return the prior result.
- Server checks authenticated account ownership and base revision, returns new server revision or a structured conflict.
- Pull applies each page transactionally, without overwriting unacknowledged local edits. Advance the cursor only on commit.
- Changed schema, unsupported entity types, and failed validation must stop that entity's sync without corrupting others.
- Sync uses bounded batches, cursor expiry handling/full resnapshot without erasing pending local changes, jittered backoff and operation audit.
- Sensitive data are not put into telemetry/logs. Encryption in transport (TLS) is mandatory.

## First sync scope (needs backend schema audit)
Start with owned birth subjects and supported saved chart metadata, then local notes and user preferences. Interpretive content, shared/team records, subscriptions, payments, non-user-owned catalogues and generated ephemerides need separate access/storage decisions. Do not indiscriminately replicate whole PostgreSQL tables or all data about a user's account.

## Important security limitation
An indefinitely usable offline session and immediate remote revocation **cannot both be guaranteed**. Policy must distinguish: local cache access, online authentication/session refresh, remote-revoked device, optional local unlock secret, optional capped offline grace period. Product owner decides tradeoffs; no invented implicit bypass.

## Minimum tests
- Fresh device offline rejected; returning device offline with valid local unlock accepted.
- Unauthorized remote entity not imported; two local account profiles strictly isolated.
- Reconnect after offline edits; crash/replay; duplicate mutation; expired cursor.
- Concurrent web and desktop change with same base revision produces conflict instead of last-write-wins.
- Server revocation blocks future online sync; UI clearly explains offline limitations.
- Timezone conversion/DST, UTC birth timestamps and locality metadata preserved exactly; unknown birth times do not gain false accuracy.
