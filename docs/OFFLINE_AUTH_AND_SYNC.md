# Guest-first local data, optional account authentication and sync

**Revised product decision 2026-11-11. Status: PROPOSED technical contract; real account sync not implemented.**
This supersedes the older mandatory first-online-activation flow. **VirgoStars Desktop must open, compute, search cities, create/save/archive natal charts and operate entirely offline without an account.**

See [OFFLINE_FIRST_MVP.md](OFFLINE_FIRST_MVP.md) and [OPTIONAL_SYNC_AND_DUPLICATES.md](OPTIONAL_SYNC_AND_DUPLICATES.md) for detailed acceptance and first-link conflicts.

## Required user journeys

### A. New local user, with or without Internet

1. First launch initializes a **local guest workspace** without requiring signup, token, online endpoint, licence activation or browser access.
2. Choose a location from a **bundled offline city catalog**, or manually supply latitude/longitude and timezone. Show the current device-clock time and calculate `Adesso` once required local ephemerides and location have been validated. Do not assume GPS or invent an Ascendant.
3. Create a chart with civil birth date/time, city and original timezone; render/save it in a durable local SQLite profile, search it later, correct its time and compare transits. Guests can create unlimited records subject only to local storage constraints, not online subscription gates.
4. Local archive changes are committed atomically and labeled `Saved locally`. There is **no pending network sync** until the user explicitly links a cloud profile. A never-linked guest must never get an auth-expired or sync-failed popup.
5. If the user quits, restarts, loses power or stays offline, local data remain accessible through the locally chosen protection/unlock policy. Local backup/export/deletion are separate user actions.

### B. Optional connection to VirgoStars online

1. Click `Connect VirgoStars`. Use system-browser OAuth 2 Authorization Code + PKCE or an explicitly reviewed equivalent. The user may cancel and immediately return to guest work; no cloud secret is embedded in Angular/Tauri resources.
2. After successful server authorization, download only owner-scoped **inventory metadata**. Do not automatically upload guest charts or overwrite local records.
3. Show a side-by-side preview with exact links, potential duplicates and conflicts; allow **Keep local / Keep online / Keep both / Merge selected fields / Skip** on each candidate. Names alone never imply identity. Record the user's choices.
4. Perform first import/link/upload in bounded, recoverable transactions. Stable local IDs remain unchanged; server IDs are separate and owner-scoped; backup existing local data and keep an explicit recovery journal.
5. After attachment, a local commit also writes an outbox mutation in the same transaction. Show `Pending sync` until accepted. Pull server changes with cursors and base revisions, never silently overwrite a local edit.
6. Disconnect/log out explicitly. The user keeps local records unless they **separately** select and confirm deletion. Remote revocation blocks future server access but cannot instantly remove an offline copy.

## State machine

`NEW_DEVICE -> GUEST_LOCAL_READY -> GUEST_EDIT/SAVE/ARCHIVE`
`                        |                 ^`
`                        v                 |`
`                   USER_OPT_IN_LOGIN --cancel/fail`
`                        |`
`                        v`
`                  REMOTE_INVENTORY -> DUPLICATE_PREVIEW -> INITIAL_RECONCILIATION`
`                        |                                    |`
`                    network fail -> GUEST_LOCAL_READY       v`
`                                                         LINKED_ONLINE`
`                                                          /        \`
`                                                    LINKED_OFFLINE  SYNCING -> CLEAN/CONFLICT`

Local guest data are never intrinsically tied to an online authorization state. Online session expiry cannot delete locally owned guest charts.

## Local-first entity model (illustrative, not deployed)

- `profileLocalId` and owner namespace independent of cloud `serverUserId`; optional cloud mapping only after login.
- `subject` / natal record with stable local chart UUID; name, natal civil date/time, DST resolution, coordinates, place snapshot, IANA timezone, unknown-time status, provenance and revisions.
- `chart_view` and settings separated from subject (house method, bodies, enabled aspects, orb settings, skin, transit-time state) to support multiple views without duplicating birth records.
- `group`, `note`, immutable snapshot/import/export metadata, optional tombstone and backup metadata.
- When linked: stable `mutationId`, `baseServerRevision`, `status`, `ackLedger`, `ownerId`, `syncCursor`, fetched server revision. Preserve conflicting versions and explain them; no name-based uniqueness constraint.
- Local catalog city/geographic reference data are separately versioned public/reference data, not private user-owned subjects and not blindly synchronized per account.

## Proposed future API only (NOT yet verified on VirgoStars online)

`POST /api/v1/desktop/devices               authorized device registration`
`GET  /api/v1/desktop/sync?cursor=...        owner-scoped paged changes`
`POST /api/v1/desktop/sync/mutations         idempotent mutations with base revision`
`POST /api/v1/desktop/devices/{id}/revoke   authenticated remote revocation`

These are illustrative path sketches from an earlier design, **not evidence of existing endpoints**. Backend owner must inspect actual schemas, permissions, migration plans, replay windows and contract versions before a separate backend PR; never connect directly to PostgreSQL.

## Invariants for optional synchronization

- Every guest chart is saved locally **before** any attempted upload. Cancelling sign-in never blocks core use or loses local work.
- Server independently enforces authenticated owner/device access, per-entity ownership and base revision; the local mapping and ledger are not authentication.
- Stable mutation IDs and atomic local outbox/ACK transactions guard retries and crashes. Duplicate receipts cannot silently advance server revision or suppress a different mutation.
- Pull applies pages transactionally; do not advance sync cursor until commit. Never overwrite a pending local mutation with an incoming record.
- Show conflict with both values and record provenance, never silent last-write-wins. Multiple different people may share names, and one person may have different versions of a chart; UI decides.
- Backoff/jitter for network failures; bounded batches; no sensitive birth content in metrics/logs; TLS and signed native builds required.
- A cloud device revoked while offline may still have locally cached data; disclose limitation honestly.
- Do not sync shared/unowned catalog data, interpretation databases, billing, subscription data, other users' subjects or server-side ephemeris kernels without separate contracts.

## Local data and security

Birth names, dates, places and notes are **personal data**; prefer SQLCipher + local OS credential vault key. A guest locally generated key must work without cloud identity. Existing isolated SQLCipher Rust and SQLite ACK prototypes in PR #11–#20 are not integrated or production validated.

If encryption delays UI testing, development-only SQLite with **fictional records** is acceptable. Any proposal to ship plaintext storage for real subjects needs a separate explicit user-facing risk decision; **no silent downgrade to plaintext** after a failed encrypted open.

Backup/restore, bad key, migration rollback, OS-user isolation and deletion require tests. User opt-in to cloud sync does not authorize background telemetry or unrelated data uploads.

## Minimum tests

- New device entirely offline creates/opens/edits/searches charts, chooses an offline city and shows the clock without login.
- User cancels/denies/loses Internet during optional login: guest records and UI stay functional.
- Same-name, different-time/place local and cloud records survive if the user selects Keep both. Exact ID vs probable duplicate distinguished.
- Unauthorized server entity is never imported; guest and two linked-account profiles are isolated, with owner checked on every sync route.
- Offline changes, crash/replay, duplicate ACK, expired cursor and concurrent edits create no data loss.
- DST gaps/folds, unknown birth time and local coordinate overrides are preserved exactly.
- Server revocation stops cloud sync but not forcibly erases an already accessible local copy.
- Encrypt/open/backup/restore tests must pass before real record distribution, or a separately approved explicit risk model is documented.

**MVP priority:** native current sky, low-latency scrub, cities and local archive precede optional cloud sync.
