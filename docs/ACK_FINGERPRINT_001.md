# ACK-FP-001 — cross-language synthetic request fingerprint

**Status: proposed test reference, not an approved sync protocol.** This contract is explicitly **fictional/ASCII-only** and not connected to real birth data, users, VirgoStars account authentication or server communications.

## Purpose

Before the Rust SQLCipher v2 outbox can use the ledger introduced in draft PR #19, its request fingerprint must match the JavaScript/TypeScript view of the **immutable persisted request**, rather than just a client-supplied mutation ID. The prior Node ledger reference computes SHA-256 over sorted JSON *without a version prefix*; that prototype's digests are **NOT interoperable** with this proposed ACK-FP-001 wire contract.

`contracts/sync/ack-fingerprint-001.json` defines three golden examples: ordinary upsert, nested JSON with key ordering, and delete without payload. The expected SHA-256 value in each entry is a **fixed independent assertion**, not generated at test runtime.

Rust implementation: `crates/encrypted-outbox-spike/src/ack_fingerprint.rs`, exported only as a synthetic library helper; no SQLCipher v2 ACK writer is enabled.

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

Executed in this turn: **5/5 Node tests passed** with Node 22.16.0. Tested exact GitHub blobs must be checked against local files. Four Rust tests authored under `ack_fingerprint.rs` cover shared vectors, key ordering, changed/unsupported data and delete/unknown fields; **Rust tests have not been compiled or executed here because the toolchain is unavailable**.

After installing and reviewing the Rust/MSVC toolchain on Windows 11:

```powershell
cargo test --manifest-path crates/encrypted-outbox-spike/Cargo.toml --lib ack_fingerprint
```

The standalone crate still requires SQLCipher dependencies and reviewed Cargo.lock. Its `validate-windows.ps1` runs the new Node suite as part of the prior synthetic test gate. Do **not** connect this to SQLCipher's v2 ledger or production until both languages pass the same vectors, duplicate JSON inputs and Unicode/number behavior are explicitly decided, and encrypted migration/receipt tests are complete.

No account data, site backend, real cloud endpoint, deployment, GitHub Actions, main merge or release is touched.
