# V2/V3 SQLCipher open safety and v3 replacement snapshot check

**Status:** isolated, synthetic-only Rust source hardening; draft branch stacked
on PR #31. No production account, Tauri IPC, backend API or real user data.

## Failure modes addressed

1. **Unexpected new database files.** Previously the shared Rust constructor
   passed SQLITE_OPEN_CREATE for every requested schema. Opening a missing
   encrypted v2/v3 archive could therefore create a new, empty filesystem
   artifact before returning UnsupportedSchema. Now only the initial,
   explicitly requested v1 synthetic constructor has SQLITE_OPEN_CREATE.
   Explicit v2/v3 opens demand that the existing file be present and use
   SQLITE_OPEN_READ_WRITE without CREATE. A missing archive fails closed
   without creating any file. Native unit tests cover both absent paths and
   the deliberately allowed initial v1 create.

2. **Unverified replacement serialization.** The v3 manual keep-local writer
   already hashes the original persisted conflict and constructs a replacement
   request. It now additionally recomputes ACK-FP-001 from the **replacement
   row read back from local_outbox inside the SAME IMMEDIATE transaction**.
   If the persisted replacement does not have the expected content, versioned
   digest, entity ID, mutation ID, operation, base revision and timestamp,
   the entire transaction aborts: no old conflict retirement, entity revision
   change, new pending intent or historical decision survives.

3. **Regression coverage.** Rust unit tests were added for explicit v2/v3
   refusal to create absent files and for the new replacement fingerprint
   using independently reconstructed synthetic request data.

## Actual evidence and scope

- GitHub source was read back and its literal constructor mode, transaction
  order and fingerprint checks were inspected. The repo's Windows manual
  validator already covers all Rust unit tests once Cargo is available.
- No Rust toolchain is present in this environment; **Rust code has NOT been
  compiled, formatted or executed**, including these new tests. No SQLCipher
  encryption, file HMAC, Windows reopen or native crash safety is claimed.
- Existing synthetic reference: 31/31 plaintext Node.js SQLite tests passed
  in the preceding development step (v2 stage, v2 conflict and v3 keep-local).
  This change does **not** represent an additional executed Rust test result.
- The restrictive ACK-FP-001 format remains ASCII/integer/synthetic-only and
  cannot process real international birth records or floating-point degrees.
- The expected digest is for data consistency, **not server authentication**;
  OS-managed keys, authenticated ownership and backend idempotency remain
  mandatory before any real sync.

## Windows acceptance gate

From this feature branch with a reviewed Rust MSVC toolchain, native SQLCipher
build dependencies and a reviewed Cargo.lock:

    powershell -NoProfile -File .\crates\encrypted-outbox-spike\validate-windows.ps1

Also inspect that neither explicit v2 nor explicit v3 open creates a new file,
that every SQLCipher open rejects a wrong key, and that v3 decision rollback
preserves the original conflict on an encrypted database after an interrupted
operation. These are tests to run, not results claimed here.

No main merge, GitHub Actions, deploy, release, private data, licensing or
repository visibility changes.
