# Offline Outbox — reference contract 001

**Status: tested pure TypeScript reference model, NOT runtime sync, storage, authentication or an authorized cloud API.**
**Date:** 2026-11-10.

## Purpose and boundaries

This branch develops only a deterministic, synthetic-data test surface for the offline-first contract described in [OFFLINE_AUTH_AND_SYNC.md](OFFLINE_AUTH_AND_SYNC.md). Its executable model is in `../contracts/offline-outbox-reference.ts`; regression tests are in `../tests/offline-outbox-reference.test.mjs`.

The future VirgoStars Desktop **Rust/Tauri host** owns SQLite transactions, credentials, user-profile isolation and authorized network synchronization. This TypeScript model is not a replacement for that host, and it must **not** be connected to real user records, uploaded data, passwords, AWS, or any unapproved endpoints.

## Semantics that are now executable

- **Profile scope:** each mutation is bound to one local profile; a cross-profile enqueue is rejected.
- **Stable mutation IDs:** exact retry with identical content is idempotent, but reusing an ID with different data raises an error.
- **Immutable FIFO outbox:** payloads are validated as JSON, limited to **256 KiB (262,144 UTF-8 bytes of serialized JSON, including JSON delimiters and escaping)**, cloned and frozen before enqueue; unsupported operations or unsafe payloads are rejected. The cap is on bytes rather than JavaScript UTF-16 string length, preventing multi-byte Unicode from exceeding the intended envelope.
- **Batching:** bounded batches (1–500) select the oldest unresolved change for each entity. Two pending changes to one record cannot be sent in the same batch.
- **Receipts:** accepted / already-applied receipts remove the specified entry in the *pure model*. No receipt or retry leaves it pending; unknown, duplicate or out-of-order receipts fail closed. Receipt validation takes a single detached snapshot of explicitly owned, enumerable data fields before applying any acknowledgements; getters, inherited fields and unexpected metadata are rejected.
- **Conflicts:** conflict receipts preserve the local change and server revision; later changes on that entity are blocked while unrelated records can continue.
- **Deletes:** explicit tombstones remain pending until acknowledged. An absent entity is not interpreted as a delete.

**Important:** `applySyncReceipts` never writes a database. In production, acknowledging a mutation and updating its entity revision must be persisted in **one local transaction** before the UI may report synchronization. The reference model does not implement safe crash recovery, schema migrations, cursor management, encryption, device authorization or conflict resolution.

## Test instructions

Install Node.js 22.16+ (or newer supported Node LTS with TypeScript stripping), then from the root of the branch run:

```powershell
node --experimental-strip-types --test tests/offline-outbox-reference.test.mjs
```

For strict typechecking, when TypeScript 5.8+ is available:

```powershell
tsc --target es2022 --module nodenext --moduleResolution nodenext --lib es2022,dom --strict --noEmit --skipLibCheck contracts/offline-outbox-reference.ts
```

### Validation performed for this proposed change

- Node 22.16.0: **11/11 tests passed** using synthetic-only records.
- TypeScript 5.8.3: **strict typecheck passed**.
- GitHub blob read-back verified **the exact source and test bytes** against the tested local copies: source SHA `545311a4ff361cb0767acdd14862067c5c7fa966`, test SHA `aca12c466ad15410fb0e48b0afac6acae25383d5`.
- No Angular build, Rust compilation, Windows executable, SQLite, API call or real user profile was tested.

## Follow-up acceptance gates

1. Approve the mutation and receipt schema jointly with the authorized backend team; entity type allowlist currently illustrative.
2. Implement equivalent behavior in the Rust host with its own unit/property tests, preserving the behavior of this reference corpus.
3. Add encrypted local transactional SQLite outbox with migrations and crash/replay tests. Do **not** store unencrypted personal birth data.
4. Define post-ack revision advancement of dependent same-entity edits and user-controlled conflict resolution. Never silently rebase/overwrite.
5. Implement server-side ownership checks and idempotent mutation processing, independent of client-side validation.
6. Test two authorized profiles/devices, cursor expiry, interrupted paging, offline access policy and device revocation.
7. Only after all gates: wire the Angular UI to a typed, narrowly authorized Tauri IPC surface with correct Pending / Syncing / Conflict status.

Repository visibility, licensing and release approval remain unchanged. Do not use GitHub Actions or merge to main without review.

## 2026-11-13 UTF-8 envelope follow-up (proposed)

The reference model now rejects JSON payloads whose UTF-8 encoding exceeds 262,144 bytes, even when their JavaScript string length is shorter. A fast UTF-16 code-unit check avoids encoding obviously oversized JSON; the final byte measurement uses `TextEncoder`. Exact ASCII and non-ASCII size-boundary regressions were added. This is **only an in-memory synthetic reference guard**, not a limit enforced by a live IPC endpoint, Rust database, or server.

## 2026-11-13 — atomic receipt-validation follow-up (proposed)

The pure reference model now snapshots each untrusted receipt into a frozen, data-only value **before** building the acknowledgement map. It checks own property descriptors rather than reading mutable/accessor-backed objects repeatedly. Supported shapes remain `{mutationId, result, serverRevision}` for accepted/already-applied/conflict, and `{mutationId, result:'retry'}` for retry; unknown, hidden and symbol fields fail closed. The full list of receipts is validated before any new outbox state is returned. New synthetic regressions cover getters, prototype-inherited fields, malformed receipts, and nonpartial application.

This does **not** implement a real network trust boundary, protection against JavaScript Proxy traps, durable SQLite acknowledgement, server authorization or signature validation. Real transport data must be decoded independently by the eventual Rust host. No real records or external services are used.
