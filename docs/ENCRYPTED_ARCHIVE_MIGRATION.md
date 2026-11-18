# Encrypted chart archive — implementation gate

**Status: Designed only (2026-11-16).** No encrypted storage, key wrapping or migration is implemented. The current `charts-v1.sqlite3` remains plain SQLite. This document is an engineering acceptance contract, not a claim of protection.

## Boundaries

- The Rust host owns database access and cryptographic keys. Angular may request operations through the existing bounded IPC but must never receive a database path, raw key, recovery secret or key-wrapping material.
- Prefer an audited encrypted SQLite implementation (evaluate SQLCipher licensing, binaries, cross-platform support and reproducible builds) over bespoke record encryption. Select and review a provider before modifying the live archive.
- Generate a fresh random database key per local profile; wrap it using Windows DPAPI/Credential Manager or macOS Keychain through a reviewed platform adapter. Never derive it from a predictable device identifier or store it in WebView localStorage.
- The current single-file archive has no profile isolation. Profile identity and storage ownership must be defined before a multi-account migration. Do not reuse a key across unrelated accounts.
- Encryption alone does not protect data while the app is unlocked or against malware running as the same user. Do not promise secure erasure of SQLite pages, journals, OS snapshots or backups.

## Migration from the existing plaintext prototype

1. **Preflight:** detect the legacy file and validate its schema version, SQLite integrity and every row using the current chart-input rules. Reject corrupt, unknown-version or invalid input without altering the original.
2. **Unlock:** create or recover the OS-wrapped profile key. If OS secure storage is unavailable or locked, stop; never fall back to plaintext.
3. **Stage:** create a *new* encrypted database in the same app-controlled data directory, with restrictive file permissions and a fresh schema. Import rows transactionally, preserving IDs, timestamps, UTC instants and coordinates exactly.
4. **Verify:** reopen the staged database using the recovered key; compare record count and deterministic content digests with the validated legacy snapshot. A wrong key must fail closed.
5. **Cutover:** atomically switch a small versioned manifest or equivalent app-owned pointer only after verification. Crash before cutover must leave the original readable by the old prototype; crash after cutover must select the verified encrypted store.
6. **Legacy retention:** do not automatically delete the plaintext file during the initial migration. Warn the user it remains sensitive; offer an explicit, documented removal workflow after backup/restore testing. Explain that ordinary deletion is not secure erasure.
7. **Rollback:** if migration fails, preserve the original byte-for-byte, remove only disposable staging files, and show an actionable error without logging birth data, paths or keys. Never downgrade a newer encrypted schema.

The UI must not report `encrypted` until a native read-after-restart and wrong-key test both pass. Backups, temporary files, WAL/journals and crash dumps are in scope; never allow plaintext sidecars in the encrypted design.

## Required verification matrix

| Scenario | Required outcome |
| --- | --- |
| Fresh installation | Only encrypted storage is created after key provisioning |
| Existing v1 archive | All fictional records survive migration with exact timestamps |
| Wrong or unavailable OS key | Archive stays locked; no plaintext fallback |
| Corrupt/newer legacy archive | Original untouched; no destructive auto-repair |
| Interrupted staging/import | Restart safely retries or reports recoverable failure |
| Interrupted cutover | Exactly one authoritative archive is selected |
| Two profiles on same machine | Separate keys and files; cross-profile reads denied |
| Concurrent process/locked file | Bounded error; no data loss or unsafe replacement |
| Backup/restore to another device | Explicit recovery design; no silent assumption DPAPI keys are portable |
| Delete/logout | Credentials removed according to policy; residual backups disclosed |
| Windows and macOS | OS key wrapping and file permissions independently exercised |

## Implementation order

1. Choose audited encryption dependency and document license/build distribution implications.
2. Add a Rust `SecureStorage` adapter with fake-key-store tests and OS-specific integration tests.
3. Add a new encrypted archive implementation alongside, **not in place of**, the v1 store.
4. Implement the migration state machine with synthetic fixtures and fault injection at each cutover step.
5. Wire UI lock/unlock/migration states and explicit legacy-file warning.
6. Perform manual Windows restart, offline and restore drills; request a separate security review before any beta.

**Not authorized by this plan:** production credentials, cloud synchronization, external services, release signing, installer distribution or automatic deletion of user data.
