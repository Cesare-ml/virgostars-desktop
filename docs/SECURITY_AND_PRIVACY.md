# Security, privacy and threat model

Status: **DESIGN / required gates**. User birth data can be sensitive personal information.


## 2026-11-11 guest-first privacy decision

VirgoStars Desktop must be fully usable offline **without any account or Internet connection**. Login is an optional cloud feature, not an activation or local-access requirement. The application must never upload guest chart records, location or notes without a separate explicit opt-in and reconciliation preview.

Birth name, civil date/time, place and notes can be **personal data**. Prefer SQLCipher with an OS-protected local encryption key provisioned for the *guest device* without cloud credentials. The separate Rust SQLCipher proof of concept is **not** a verified production database. Plain SQLite may support **fictional development fixtures only** unless a distinct, documented user-facing security decision approves storage of real records. No silent plaintext downgrade when encrypted open fails. Security reviews must cover OS user isolation, key loss, backup/restore, schema migration, consent and deletion.

Offline city lookup is bundled/versioned reference data and may be updated separately from personal charts. No silent GPS lookup. Optional cloud sync has owner checks and explicit duplicate/conflict choices (including **Keep both**); matching names never justify automatic merging. See [Offline MVP](OFFLINE_FIRST_MVP.md), [Cities and Timezones](OFFLINE_PLACES_AND_TIMEZONES.md) and [Optional Sync](OPTIONAL_SYNC_AND_DUPLICATES.md).

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
