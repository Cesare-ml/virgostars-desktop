# Offline Outbox — reference contract 001

**Status: tested pure TypeScript reference model, NOT runtime sync, storage, authentication or an authorized cloud API.**
**Date:** 2026-11-10.

## Purpose and boundaries

This branch develops only a deterministic, synthetic-data test surface for the offline-first contract described in [OFFLINE_AUTH_AND_SYNC.md](OFFLINE_AUTH_AND_SYNC.md). Its executable model is in `../contracts/offline-outbox-reference.ts`; regression tests are in `../tests/offline-outbox-reference.test.mjs`.

The future VirgoStars Desktop **Rust/Tauri host** owns SQLite transactions, credentials, user-profile isolation and authorized network synchronization. This TypeScript model is not a replacement for that host, and it must **not** be connected to real user records, uploaded data, passwords, AWS, or any unapproved endpoints.

## Semantics that are now executable

- **Profile scope:** each mutation is bound to one local profile; a cross-profile enqueue is rejected.
- **Stable mutation IDs:** exact retry with identical content is idempotent, but reusing an ID with different data raises an error. Enqueued mutation envelopes must contain their explicitly allowed own, enumerable data fields; unexpected, accessor-backed and inherited fields fail closed before IDs or payloads are read.
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

## 2026-11-13 — immutable mutation-envelope capture (proposed)

Following the serialized UTF-8 cap (#143) and untrusted receipt snapshot (#158), enqueue now captures the **mutation envelope** using own data-property descriptors exactly once. The seven required fields are `profileId`, `mutationId`, `entityType`, `entityId`, `operation`, `baseServerRevision`, `createdAtUtc`; an upsert additionally needs a `payload` while delete must omit it. Non-plain prototype objects, accessors, inherited/missing fields, unlisted fields (including hidden/symbol properties) and arrays are rejected. Standard plain objects and null-prototype objects with explicit data fields remain accepted.

This prevents mutable getters from changing the identity, profile or operation between validation and queuing. Payload JSON validation, UTF-8 size checks, defensive clone/freeze and conflict checks remain in place. It is not an executable encrypted database, persistence, OS credential protection, a network protocol or a server ownership check. Adversarial JavaScript Proxies are not a supported transport format; the eventual Rust IPC boundary must decode and validate separately.

## 2026-11-14 — receipt batch container preflight (proposed)

The synthetic `applySyncReceipts` boundary now validates the **outer receipt array** before inspecting or applying any ACKs. It accepts a dense ordinary array (including frozen/empty arrays) with no more than **500** receipts, matching the reference model's maximum `nextSyncBatch` size. Each element must be an own, enumerable, data-only numeric array index. It rejects holes, custom iterators, getter-backed indices, extra/hidden/symbol fields, non-array iterables, and altered array prototypes. The array is copied into a frozen list before individual receipt validation, so a replaced iterator cannot silently omit or reorder ACKs.

This closes a separate gap from the individual receipt validation (#158) and mutation envelope snapshot (#162): the outer collection is no longer trusted merely because each received element looks valid. The source includes synthetic regression tests for the 500-item boundary, malformed containers, no accessor/iterator invocation, and preservation of pending edits on rejection.

**Limits:** This remains an in-memory, synthetic TypeScript reference, not an IPC deserializer, encrypted database transaction, live cloud synchronization, network protocol or actual crash-recovery implementation. JavaScript Proxy traps are not a supported transport representation. A future Rust protocol must enforce its own batch bound and decode untrusted JSON before applying durable acknowledgements.
