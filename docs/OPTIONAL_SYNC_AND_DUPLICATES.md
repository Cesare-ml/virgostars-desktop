# Optional VirgoStars login, local archive and no-loss synchronization

**Approved direction 2026-11-11. Status: DESIGN ONLY; no authentication, online sync or real-profile migration implemented.**
The app must be fully usable as a **guest/local-only program** from first launch onward. An optional VirgoStars account provides cloud backup and multi-device synchronization, not permission to use the core program.

## Initial state machine — reverse the old mandatory-login assumption

`FIRST_RUN -> GUEST_LOCAL_READY -> CREATE/OPEN/EDIT/SAVE/EXPORT_OFFLINE`

At any time, the user may choose `Connect VirgoStars`:
`GUEST_LOCAL_READY -> AUTHENTICATING -> INVENTORY_PREVIEW -> RESOLVE_DUPLICATES -> INITIAL_SYNC -> CONNECTED_READY`.

Failure, cancel, network loss or timeout returns to **GUEST_LOCAL_READY with every local record preserved**. A login interruption never deletes unsynced local work. Connected mode can become `CONNECTED_OFFLINE` with the same local create/read/edit capabilities, and writes wait in the local outbox. Logging out/unlinking does not silently delete local charts; require an explicit separate action to erase profile data.

No first-use online activation, subscription/license gate, forced login, hidden background registration or continuous connection. This supersedes older mandatory-account text elsewhere in the repository.

## Identity, storage and provenance

- Every chart created offline has a stable, locally generated **UUID** and a device-local owner namespace; local ID does not change when linked to a server account. Server entity ID, if any, is a separate field.
- Data model distinguishes `subject` (person/place/date), `saved_chart` (chart metadata), `chart_view/settings`, `group`, `note`, local mutation outbox and sync bookkeeping. A birth chart name is just a label, **not** an identifier.
- Local records include revision, provenance (`local_created`, `remote_imported`, `both_linked`), last-modified timestamps, field-level source where necessary and source server/account IDs only after authorization.
- Account linkage is **per local profile**, with an explicit choice to create a new isolated profile versus attach guest charts. Never upload another OS user/profile's data or silently combine two VirgoStars account owners.
- Do not assume VirgoStars Online exposes versioned desktop APIs. Backend owner must confirm real schema, owners, request limits, ETags/revisions and allowed operations; avoid direct PostgreSQL or copying cloud production data.

## The first sign-in with an existing local archive

1. Authenticate in the **system browser** via a reviewed authorization-code + PKCE flow; keep tokens out of URLs, logs and renderer storage. Verify owner on server independently.
2. Download **only an authorized metadata inventory** of cloud chart IDs/names, timestamps and sufficient comparison fields; do not overwrite local data. Avoid transferring private birth details for unrelated users.
3. Present a reviewable side-by-side **reconciliation preview**, with counts: local only, cloud only, linked exact match, likely duplicate, conflicting edits. The user explicitly chooses upload/import/link/skip policy.
4. Determine identities in this order:
   - Already linked same remote ID and owner → sync against revisions.
   - Same **stable exported/imported UUID** with provenance and matching owner → candidate exact link, verify normalized birth fields and revisions.
   - Same name AND same natal civil date/time/timezone/location/coordinates → **possible duplicate only**, never automatic identity merge.
   - Same name but different date/place/time → **different records** by default; allow both, rename locally/display suffix, or manual compare.
   - Different names but matching birth data → possible duplicate; never automatically delete either.
5. For each candidate, provide choices: **Keep local**, **Keep online**, **Keep both**, **Link same chart**, **Merge selected nonconflicting fields**, **Skip for later**. Show actual differing values before a merge (date, time, unknown-time flag, locale, geographic coordinates, TZ, notes, groups, settings, revisions). Keep both as the **safe default** if the user is unsure.
6. Before applying, take an encrypted/privacy-reviewed local backup; present a dry-run action summary. Import/export under a transaction, with stable idempotency keys and a recovery journal. A failed sync can retry without duplicating or dropping records.
7. After first reconciliation, store mapping `localId ⇄ remoteId ⇄ ownerId` and version/revision/cursor. Show progress, pending changes and conflicts; user can disconnect anytime and continue offline.

No last-write-wins on conflicting chart edits, especially birth time, place, notes or account ownership. Never infer sameness merely from matching display names.

## Regular synchronization after linking

- Each local mutation and its outbox intent are committed **atomically**, while UI clearly says `Saved locally / Pending sync` versus `Synced`.
- Server applies idempotent mutation IDs after validating owner, per-device access and base revision. Rust/SQLCipher outbox prototypes in the independent PR #11–#20 chain are **experimental**, and their reference code must not be silently wired to production.
- Reconnection uploads bounded batches; then downloads owner-scoped changes using versioned cursors. Apply each page in one local transaction, and never advance the cursor until committed.
- On conflict preserve both local and remote candidate versions and notify the user. Deletion should use tombstones and deliberate confirmation; delete conflict requires its own UX. No destructive default merge.
- Handle token expiry, revoked online devices, server schema updates, reordered/delayed/double ACKs, dropped HTTP connections and repeated app restarts. Offline revocation cannot instantly erase data from a disconnected computer.
- Guest preferences (skin, place, settings, offline cities cache) remain usable even when account sync fails; consider preference sync as a separately opt-in data category rather than a prerequisite to chart sync.
- The city reference catalog is public app data and updates independently; it must not be cloned per account as user subject records.

## Local database and encryption decision

- **Real natal records are personal information:** name, date/time/place of birth and notes can identify people or contain sensitive details depending on content. Avoid claiming "not sensitive" or implying encryption alone solves privacy.
- **Priority:** get reliable, usable offline create/save/open/search/edit first, while designing a privacy-safe storage boundary from day one. Keep `LocalRepository` independent of `CloudSyncClient` and transport serialization.
- Preferred option: use SQLite/SQLCipher for actual user profiles, with OS-managed locally provisioned encryption key (Windows DPAPI/Credential Manager, macOS Keychain later) and a reviewed key-loss/backup/recovery policy. Crucially, a **guest profile must generate/access its key without requiring an online account**.
- The isolated encrypted outbox crate (PRs #14/#15/#20) is *a prototype*, not a vetted production database; the main Tauri shell currently has no real storage. Validate it with native Rust/Windows tests and encryption/provenance review.
- If SQLCipher materially blocks the first prototype, a **plain local SQLite development mode with explicitly synthetic data only** can unblock UI tests. Any proposal to persist real data unencrypted requires a separate documented user-facing security decision, controls, and review; **never silently fall back from an encrypted real profile to plaintext after an error**.
- Encryption changes may be added later only with consent, backup, transactional migration, rollback and file/key integrity tests. Encryption cannot prevent access when the OS session/app is unlocked and must not be described as absolute protection.
- Offline archive must have clear import/export and backup/restore choices; devise local recovery before enabling destructive schema changes.

## Required tests (P1 sync, after P0 guest archive)

1. Fresh install with airplane mode: no login prompts; create 3 charts including same names; save/reopen after application restart.
2. Connect a newly created VirgoStars account with one cloud chart identical to local and one same-named but different → user receives **separate candidates**; Keep both preserves both.
3. Server denies authentication or user cancels mid-attach → all local data remain usable and no orphaned owner mappings.
4. Reconcile two fields with conflict, choose Keep local/online/both, crash before and after commit; never lose either version.
5. Disconnect and reconnect after 100 local edits; outbox queues and sync results dedupe by stable mutation ID.
6. Compare across devices with per-account authorization and malicious/nonexistent remote IDs; unauthorized rows never leak.
7. Different people with identical names; different names with identical natal fields; stale timezone data; missing birth time; deleted/renamed city; duplicate migration and interrupted download.
8. Wrong DB key, corrupted journal, SQLCipher schema mismatch and backup recovery. Encrypted mode fails closed; no hidden fallback.
9. Sign out, switch accounts, and inspect offline profile boundaries; no silent uploads of a guest profile to the wrong account.

**No production account synchronization is available or authorized by this document.**
