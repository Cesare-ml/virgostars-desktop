# ACK-FP-001 — cross-language synthetic request fingerprint

**Status: proposed test reference, not an approved sync protocol.** This contract is explicitly **fictional/ASCII-only** and not connected to real birth data, users, VirgoStars account authentication or server communications.

## Purpose

Before the Rust SQLCipher v2 outbox can use the ledger introduced in draft PR #19, its request fingerprint must match the JavaScript/TypeScript view of the **immutable persisted request**, rather than just a client-supplied mutation ID. The prior Node ledger reference computes SHA-256 over sorted JSON *without a version prefix*; that prototype's digests are **NOT interoperable** with this proposed ACK-FP-001 wire contract.

`contracts/sync/ack-fingerprint-001.json` defines three golden examples: ordinary upsert, nested JSON with key ordering, and delete without payload. The expected SHA-256 value in each entry is a **fixed independent assertion**, not generated at test runtime.

Rust implementation: `crates/encrypted-outbox-spike/src/ack_fingerprint.rs`, exported only as a synthetic library helper. TypeScript/Web Crypto implementation: `contracts/sync/ack-fingerprint-001.ts`, also synthetic-only and not imported into the production application. No SQLCipher v2 ACK writer is enabled.

Node oracle: `tests/ack-fingerprint-001.test.mjs`, automatically added to the manual Windows synthetic check.

## Exact proposed fingerprint algorithm

1. Accept a **typed** JSON request with precisely the keys `profile`, `mutation`, `entityType`, `entity`, `operation`, `baseRevision`, `createdAt` and, for upserts only, `payload`. Required keys may not be omitted. Unknown fields are rejected in Rust deserialization. No JSON duplicate-field handling is authorized until the external parser contract is reviewed.
2. For the isolated synthetic prototype, `profile`, `mutation`, `entity` start with `synthetic-`, `entityType` is `subject`, `operation` is `upsert` or `delete`. `baseRevision` is null or a printable ASCII string of at most 128 bytes; timestamp is a fixed-shape UTC seconds string. Calendar validity is a separate domain check.
3. Require ASCII printable characters for strings and keys, safe integers only (absolute value <= 9007199254740991), no fractional/exponent numbers, no `__proto__`/`constructor`/`prototype` keys, and JSON recursion depth at most 64. Upsert requires a non-null payload; delete requires payload **absent**, not null. Serialized request is limited to 262144 bytes. These strict restrictions deliberately **exclude normal international names, accented text and floating-point astrological values** and therefore **MUST NOT** be silently used for real profiles; a Unicode/number-compatible successor protocol needs explicit review.
4. Encode as compact JSON, recursively sorting object keys by ascending ASCII byte order; preserve array order. For this restricted subset, Rust's ASCII byte order matches JavaScript's UTF-16 lexical order.
5. Compute lowercase hex of `SHA-256(UTF8("virgostars-ack-fp-001\\n") || UTF8(canonical_json))`. The prefix contains a real line-feed byte at the end, not literal backslash+n. **SHA-256 is not a MAC or authenticated receipt** and cannot replace identity verification or server-side owner checks.
6. Compare the fingerprint to the ledger fingerprint **and** verify entity, profile, oldest pending revision and accepted server response. The future Rust code must derive fingerprint inputs from its **persisted outbox snapshot**, not mutable UI state.

## Tests and constraints

Run from the repo root with Node >= 22.16:

```powershell
node --test tests/ack-fingerprint-001.test.mjs
```

Executed in this turn: **5/5 Node tests passed** with Node 22.16.0. Tested exact GitHub blobs must be checked against local files. Five Rust tests authored under `ack_fingerprint.rs` cover shared vectors, key ordering, changed/unsupported data, delete/unknown fields, and strict wire decoding of missing/null fields; **Rust tests have not been compiled or executed here because the toolchain is unavailable**.

After installing and reviewing the Rust/MSVC toolchain on Windows 11:

```powershell
cargo test --manifest-path crates/encrypted-outbox-spike/Cargo.toml --lib ack_fingerprint
```

The standalone crate still requires SQLCipher dependencies and reviewed Cargo.lock. Its `validate-windows.ps1` runs the new Node suite as part of the prior synthetic test gate. Do **not** connect this to SQLCipher's v2 ledger or production until both languages pass the same vectors, duplicate JSON inputs and Unicode/number behavior are explicitly decided, and encrypted migration/receipt tests are complete.

No account data, site backend, real cloud endpoint, deployment, GitHub Actions, main merge or release is touched.

## Compatibility hardening — 2026-11-11

The original in-test JavaScript oracle used `Number.isSafeInteger` and a limited envelope check; Rust uses a typed Serde DTO. Audit identified that the old JavaScript reference accepted IDs longer than 128 characters or an empty base revision, while a derived Rust `Option<T>` decoder could accept a missing required `baseRevision` or an explicitly-null delete `payload` as though the field were absent.

**New executable TypeScript implementation:** `contracts/sync/ack-fingerprint-001.ts` exports `canonicalAckRequest001(unknown): string` and asynchronous `ackFingerprint001(unknown): Promise<string>`. It is compatible with browser Web Crypto and therefore does not depend on Node's `crypto` package. It rejects non-plain objects, accessors, symbol keys, unsafe property names, sparse arrays, unsupported decimal/negative-zero values, missing/extra fields, ID lengths >128, missing/empty/Unicode revisions, and non-ASCII values. No getters are intentionally invoked. Only **synthetic records** are accepted; no real names, locations or decimal astrological positions are permitted.

**New strict Rust decoder:** `AckRequest` now deserializes through a private `WireAckRequest` DTO with a required raw `base_revision` and a payload-presence enum. This preserves the distinction between `baseRevision: null` (required and valid) versus an omitted `baseRevision` (invalid), and between absent delete payload (valid) versus an explicitly `null` payload (invalid). Unknown/duplicate wire fields are rejected by Serde. `fingerprint()` still validates manually-constructed DTOs. This is only a library contract; it is **not** wired to the real ACK ledger, account storage or cloud.

**Executed on Node.js 22.16.0:** `node --experimental-strip-types --test tests/ack-fingerprint-typed.test.mjs` passed **6/6**; `tsc --target es2022 --module nodenext --moduleResolution nodenext --lib es2022,dom --strict --noEmit --skipLibCheck contracts/sync/ack-fingerprint-001.ts` passed. This does **not** prove Rust/TS equality until the shared Rust golden tests run. The original independent Node reference suite remains as a separate golden-vector oracle; its legacy boundary validation is superseded by the stricter TS module.

The manual Windows validation script now includes both golden suites and uses Node's `--experimental-strip-types` flag. **Cargo test/fmt/clippy, Windows PowerShell and native SQLCipher have NOT been run here** because the Rust toolchain is unavailable. Approval requires the same vectors to pass under compiled Rust and TypeScript, plus a reviewed Unicode/decimal-number successor contract before any use with real VirgoStars astrology profiles.

**Known limitation:** textual wire JSON numbers like `1.0` can lose their decimal spelling when parsed by JavaScript, while `serde_json` may preserve them as floating-point values. The format remains **fictional-only** and does not authorize parsing untrusted raw JSON numbers without an agreed versioned wire parser. A SHA-256 fingerprint is not a MAC or receipt authentication.

## Versioned ACK ledger integration — synthetic SQLite reference (2026-11-11)

New: `tests/sqlite-ack-fp001-ledger.test.mjs`. The earlier SQLite v2 ACK reference hashes *unversioned* JSON. This newer executable reference instead uses the **real exported `ackFingerprint001()` Web Crypto implementation**, and explicitly derives the request used for the acknowledgement from the **durable `local_outbox` row** (including the exact nullable base revision, UTC fixture time and omission of delete payloads). It verifies that all three v1/v2 SQLite schema objects and existing tables work together under the proposed domain-separated ACK-FP-001 digest.

The prototype places any asynchronous Web Crypto work **before** starting the synchronous SQLite transaction. After acquiring `BEGIN IMMEDIATE`, it re-reads the pending row, compares it to the pre-hash snapshot, checks FIFO eligibility and server-base revision, then atomically inserts the ACK ledger row, updates the entity revision and removes only the precise acknowledged outbox row. A repeated receipt must match **stored fingerprint, status and revision**. Conflicting repeats and reused mutation IDs do not touch entity data. An injected pre-commit error rolls back all three database changes. The ledger remains durable across closing and reopening a **temporary synthetic-only** SQLite file.

**Actually executed on Node.js 22.16.0:**

```powershell
node --experimental-strip-types --experimental-sqlite --test tests/sqlite-ack-fp001-ledger.test.mjs
```

**10/10 passed** in this turn. Exact GitHub blob `2b3409ef6ca0d2ac8780d04d1f0482b70703aad5` matches the locally executed test file. The Windows manual script now includes it in the synthetic reference suite. The SQLite engine used by this test is **plaintext** in a temporary directory, not SQLCipher; no real profile or birth data is involved.

### Important limitations and next safe native step

- **Do not connect this test harness to Tauri or production.** It uses experimental Node `node:sqlite`, a fictional timestamp and synthetic-only identifiers. It does not verify server identity, user ownership, credential revocation, transport authentication or the actual Rust encrypted store.
- The original `tests/sqlite-ack-ledger.test.mjs` remains a historical unversioned prototype and **must not be treated as an interchangeable protocol**. An approved migration of existing ledger fingerprints will require an explicit compatibility policy rather than silently overwriting hashes.
- The future Rust v2 writer must reconstruct the typed request **from the persisted outbox row**, call Rust's `ack_fingerprint::fingerprint()`, reject any mismatch, and commit ACK + revision + deletion in one SQLCipher transaction. It must reject dependent stale-base edits, prevent mutation-ID reuse, isolate profiles and keep durable ACK rows through restarts.
- A SHA-256 fingerprint only identifies request bytes; it does **not authenticate server receipts**. Server-side idempotency and authorization are necessary. Original v1 ACKs that were removed before a ledger existed remain historically unrecoverable by client-only migration.
- Cross-language Rust test execution, encrypted SQLCipher build, OS-protected key management, backups/rollback and real Unicode/decimal astrological payload support remain **blocking**. This proposed contract rejects accented names and decimal positions, so it is not suitable for real chart data yet.

No GitHub Actions, merge to main, deployment, license change or production database actions were performed.
