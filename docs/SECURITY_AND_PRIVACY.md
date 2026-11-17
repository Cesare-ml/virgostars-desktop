# Security, privacy and threat model

Status: **DESIGN / required gates**. User birth data can be sensitive personal information.

## Assets and trust zones
- Device: application binary, local birth-data DB, queued edits, downloaded assets/kernels, device keys.
- Webview: Angular/Three.js presentation logic. Treat rendered external/user text as untrusted and restrict IPC capabilities.
- Rust host: local DB and filesystem access, OS key store, tokens, sync scheduler and verified update installation.
- Cloud: VirgoStars identity, authorization, production database, versioned owner-safe sync endpoints.
- Release infrastructure: private signing keys, public verification keys and signed update manifests.

## Rules
1. No embedded API secrets or privileged service keys in client binaries/source. System-browser auth with PKCE; no login form that captures VirgoStars password inside an arbitrary WebView.
2. Short-lived online access tokens and refresh token rotation/revocation strategy; secrets in DPAPI/Credential Manager on Windows, Keychain on macOS, accessed via a reviewed abstraction. **Never localStorage**, ordinary app config or console logs.
3. Encrypt local personal records at rest using an audited design. Evaluate SQLCipher and key-management/license/build requirements rather than claiming plain SQLite is encrypted. Use OS-protected key wrapping, recovery/key rotation and per-user profiles.
4. Tauri capability allowlist: minimum commands, no unbounded shell execution, no arbitrary filesystem access to untrusted paths, restrictive CSP and navigation rules.
5. Backend checks every entity's owner, field visibility, device scope, rate limits, token audience and permission transitions. A client-side filter is not an authorization barrier.
6. Synced deletions vs secure local deletion need a data-retention policy; backup/restore must preserve user consent and encryption.
7. Update public key may be distributed; update signing private key and OS code-signing credentials must never enter Git history. Verify authentic release origin, immutable manifest and rollback strategy.
8. No analytics by default in private birth chart contents. Telemetry, if proposed, needs explicit privacy review and minimum data collection.
9. Dependency supply-chain controls, license review, pinned lockfiles and vulnerability audit before public build.
10. The client must not silently upload synthetic fixtures, local scripts, personal comments or local-only research notes unless user-approved sync scope includes them.

## Chart archive: deviation resolved, review pending (2026-11-17)

The prototype chart archive first stored user-entered birth data in a plain SQLite file (deviation of 2026-11-15). It is now an encrypted, authenticated single file with a random key held by the OS credential store, migrated from the old file with a read-back check and fail-closed behaviour ([Encrypted archive](ENCRYPTED_ARCHIVE.md)). Rule 3 is met for the archive at rest, with a documented deviation from "evaluate SQLCipher" (whole-file AEAD instead), no recovery key, and **no separate security review yet**: that review is still required before any beta. The old plain file stays on disk until the user deletes it, and ordinary deletion is not secure erasure.

## Threats to test
- Stolen laptop / offline attacker; unprotected unlocked session; database copied from disk.
- Token theft or reuse from logs; fake OAuth callback or wrong redirect target; refresh-token compromise.
- XSS through user notes/subject names reaching a native privileged IPC command.
- Cross-user ID guessing, stale permissions and accidental multi-account cache leakage.
- Connection interruption during sync, duplicate writes, conflicts and malicious server payload.
- Compromised update server, unsigned artifacts, wrong architecture/OS installer and downgrade.
- Malicious/unlicensed third-party graphic assets and unvalidated ephemeris data files.

## Blocking review before first beta
A reproducible encryption/keychain demo; static and dependency audit; IPC permission review; synthetic ownership tests; offline data deletion and restore drill; updater invalid-signature test; documented privacy policy and notice for optional telemetry; external security review where feasible.
