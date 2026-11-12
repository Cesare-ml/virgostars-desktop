# Synthetic SQLCipher v3 closed-file recovery drill

**Status: TEST-ONLY SOURCE PROTOTYPE, NOT A BACKUP FEATURE.**
This slice is stacked on draft PR #33. It contains no production/Tauri
integration, account access, user data, cloud access, key export, data migration
or automatic repair. The private repository licensing status is unchanged.

## Test-only Rust experiment

The source module crates/encrypted-outbox-spike/src/synthetic_backup_drill.rs
is included from lib.rs only behind the Rust cfg(test) attribute. Therefore it
is not part of a normal/release library build.

It seeds an encrypted fictional SQLCipher v3 archive containing one immutable
keep-local decision and one replacement still pending, then CLOSES the source
connection before attempting a copy. Its internal helper
copy_closed_synthetic_v3 is NOT a shipping backup API:

1. Refuses missing, symlinked, undersized or oversized (more than 16 MiB)
   source files and any journal, WAL or SHM sidecars.
2. Rejects the plaintext SQLite magic header. Opens the source through
   the real v3 SQLCipher key/HMAC/schema/foreign-key gate and verifies the
   archive with the pre-existing semantic audit.
3. Copies encrypted bytes to a unique temporary file in the destination
   directory; flushes and syncs the staged bytes. The temporary file handle
   is closed before native SQLCipher reopening, including on Windows.
4. Reopens the staged copy using the SAME SQLCipher key and reruns the v3
   schema and semantic audit.
5. Uses tempfile TempPath.persist_noclobber for no-overwrite publication.
   Injected pre-publish errors remove the staged file without touching the
   source or the intended final destination.

This helper assumes a QUIESCENT, CLOSED, synthetic source in a single-process
test. It has no cross-process lock, live WAL backup, OS key wrapping,
authenticated backup authorization, real-user isolation, atomic application
snapshot coordination, destination trust model or restore UI. NEVER invoke it
on a live archive or expose it through a Tauri command.

Six Rust tests were AUTHORED, NOT COMPILED OR EXECUTED:

- Ciphertext is not the ordinary plaintext SQLite header and an encrypted
  copy reopens with an intact decision history and pending mutation.
- Wrong key and wrong schema version do not open the copied file.
- Existing target bytes are not replaced, original remains unchanged.
- Injected pre-publish failure removes staging and leaves a usable original.
- Truncated and modified copies fail the SQLCipher open/integrity gate.
- Journal-sidecar and symbolic-link sources are refused.

All fixture keys are deterministic and fictional for these isolated tests.
They must NEVER be used for genuine profiles. The native module does NOT
implement any plaintext SQLite fallback.

## Verification actually executed

The standalone test
tests/synthetic-v3-opaque-backup-fileflow.test.mjs exercises filesystem
staging, no-clobber publication and interruption failure cases with random
fictional OPAQUE BYTES, not actual SQLCipher. It is self-contained and
does not need the desktop application, database, private accounts or network.

    node --test tests/synthetic-v3-opaque-backup-fileflow.test.mjs

Node.js 22.16.0: 8/8 TESTS PASSED (run and rerun).
Git blob of the locally executed and byte-identical GitHub file:
8c5d2c31c23337751ed5bc4d5f187431a9f9f122

The manual Windows test script adds the opaque-file suite to the existing
Node tests and will execute the new native Rust tests only if the reviewed
toolchain is available. Without a reviewed Cargo.lock it reports NOT READY.

## Requirements before REAL encrypted backup/restore

1. Install and review Rust MSVC 1.89+, C++ tools, SQLCipher/OpenSSL, Cargo.lock;
   run Rust format, Clippy and ALL locked tests; prove actual encryption,
   HMAC integrity and wrong-key rejection on Windows 11.
2. Prove a real SQLCipher backup procedure using a database-owned snapshot
   or exclusive app-owned lock. NEVER copy an open/writing database file,
   particularly with an unbacked-up WAL or hot journal.
3. Add OS-bound key protection (DPAPI/Keychain), independent recovery key
   policy, authorized profile-scoped backup manifests, secure restore
   destination/overwrite consent, retention and metadata minimization.
4. Test backup/restore after crashes, process termination, disk full, wrong
   keys, corruption and schema upgrade failures with encrypted fictional
   files. Compare restored local outbox and conflict history byte-for-byte
   through the versioned canonical fingerprint protocol.
5. Review Tauri capability policy, signed updates, per-user backend
   ownership, server ACK idempotency and offline revocation limitations.
   Current ASCII/integer-only ACK-FP-001 does NOT support real names or
   decimal astrological data.

No GitHub Actions, main merge, deploy, production account, real archive,
release, license or repo visibility changes took place.
