# Encrypted chart archive — 2026-11-17

Status: **Locally tested** on one Windows 11 machine. Not security-reviewed; a separate review is required before any beta ([Security and privacy](SECURITY_AND_PRIVACY.md), rule 3).

## What it is

The archive of saved charts ([Chart archive](CHART_ARCHIVE.md)) is one **sealed file**, `charts-v2.vsarchive`, in the application's local data folder:

```text
"VSARCHV\0" (8) | format version (1) | random nonce (24) | ciphertext + 16-byte tag
```

- The content is a whole SQLite database, encrypted and authenticated with **XChaCha20-Poly1305** from the RustCrypto crate `chacha20poly1305` (no home-made primitive). The header is authenticated as associated data. Every write uses a new random 192-bit nonce.
- While the application runs the database lives **in memory** (`serialize`/`deserialize`). Each change is sealed to a staging file, flushed, and moved over the archive atomically, so the previous archive stays intact until the move. No plain page, journal, WAL or temporary copy is ever written.
- The key is **256 random bits** made on this device and kept by the operating system's credential store through the `keyring` crate (Windows Credential Manager; macOS Keychain is compiled in but not exercised) under the current user, entry `chart-archive-key-v1` of service `it.virgostars.desktop`. It is not derived from any device identifier, never written to a file or to WebView storage, and never crosses IPC. It is wiped from memory when dropped.
- **No plaintext fallback.** If the credential store is unavailable, or the key is missing or different, the archive stays **locked** (`archive_locked`): nothing is written and nothing is replaced. A missing key is never replaced by a new one over an existing archive. A tampered file also reads as locked (wrong key and altered file are indistinguishable by design); a truncated or foreign file is `archive_corrupt`; a newer format is `archive_newer`. None of them is modified.
- The WebView never supplies a path and never receives a key. The IPC gained one operation (`remove_legacy`) and one response field (`legacyPresent`); the command count is unchanged.

## Migration of the first prototype's plain file

On first use, if `charts-v1.sqlite3` exists and no sealed archive does: validate it read-only (SQLite health, schema version, every row against today's rules), make or load the key and check that it reads back identically, write the sealed archive to a staging file, **reopen it with the key as the credential store gives it back and compare it with the validated rows**, and only then move it into place. Timestamps, ids, instants and coordinates are preserved exactly. A refused legacy file (corrupt, newer, invalid row) is left byte-for-byte as it was and no key is made.

The plain file is **kept**. The archive panel warns that it is still on disk and offers **Delete the old unencrypted file**, after a confirmation. Ordinary deletion is not secure erasure: the plain bytes may remain on the disk, in snapshots or in backups. If both files exist the sealed archive wins and the plain one is ignored.

## Limits, stated plainly

- Encryption protects the file **at rest**. It does not protect data while the archive is open in memory, nor against malware running as the same Windows user, which can ask the credential store for the key.
- **No recovery key and no portability.** The key lives in this user's credential store. If that credential is deleted, the Windows profile is reset or the file is copied to another device, the archive cannot be opened. Keep the old plain file (or another backup of your own) until you are sure; there is no export yet.
- Every change rewrites the whole file. That is fine for what it holds (a few kilobytes per hundred charts, at most 5000) and is not meant to scale.
- Concurrency is serialised inside one process only. Two running instances could overwrite each other's change.
- Per-profile isolation is whatever Windows provides (one credential store and data folder per user); there are no application profiles yet.
- Deviation from the design gate drafted on 2026-11-16 (`docs/encrypted-archive-migration-gate-20261116`): that gate prefers an audited encrypted SQLite such as SQLCipher. SQLCipher needs OpenSSL, which on Windows means a system install or a vendored build with Perl and NASM, an extra shared library or a much heavier build, and a harder reproducible public-source build. Whole-file authenticated encryption with an audited AEAD keeps the build pure Rust and removes the journal/WAL/temp-file problem entirely. The gate's other requirements (OS key wrapping, staged migration with read-back, fail closed, no automatic deletion, no plaintext sidecars) are met.

## Verification

| Scenario | Result |
| --- | --- |
| Fresh installation | Rust test: nothing is written and no key is made until the first save; the first save creates only the sealed file, which holds no plain text. |
| Existing v1 archive | Rust tests (exact ids, timestamps, coordinates; legacy file byte-identical; second start does not migrate again). Native: the real archive of this machine migrated, listed the same number of charts, was readable after a restart, and the legacy file's SHA-256 was unchanged. |
| Wrong or unavailable key | Rust tests with a fake key store: locked, files byte-identical, no key made over an existing archive. Not exercised natively (the real credential was not touched). |
| Tampered, truncated, foreign, newer file | Rust tests: told apart, never modified; every changed byte of the sealed container fails authentication. |
| Corrupt, newer or invalid legacy file | Rust tests: refused, untouched, no key made. |
| Interrupted write | Rust test: a stale staging file is discarded and the archive is intact. No fault injection at each step of the final move (it is a single rename). |
| Native read-after-restart | Passed: a chart saved through the interface was listed after restarting the application and deleted again. |
| Two profiles; concurrent processes; backup/restore to another device; macOS | **Not covered.** |

The interface describes the archive as encrypted only because the native restart check and the wrong-key tests above passed.
