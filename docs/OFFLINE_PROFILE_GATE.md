# Synthetic offline-profile access gate (UI decision contract v1)

**Status: locally tested pure TypeScript prototype; NOT wired to the Tauri host or the Angular application.** This gate does not unlock a profile, authorize a user, authenticate a native response, encrypt data or provide real sync. It is a small, independently reviewable specification for future offline startup UI state.

## Purpose

A valid VirgoStars online session alone must never unlock an absent, locked or unreadable local profile. Conversely, an authorized profile whose encrypted cache has already been unlocked by a trusted native adapter should remain usable for local viewing and edits when Internet access or the online session disappears, subject to the final device security policy. These behaviors are described in [Offline Auth and Sync](OFFLINE_AUTH_AND_SYNC.md) and [Security and Privacy](SECURITY_AND_PRIVACY.md).

`src/app/native/offline-profile-gate.ts` exports `decodeOfflineProfileEvidence` and `assessOfflineProfileAccess`. The former accepts only the exact 10-field, version-1, data-only shape with valid boolean/enum fields, an integer bounded pending-operation count, and consistent cache/key/activation states. Extra, inherited, accessor, non-enumerable or throwing properties fail closed. Accepted values are copied to a new frozen object. This is *schema validation*, not proof that a caller or IPC source is trusted.

The latter generates a frozen **UI / action-eligibility decision**:

| Situation from an eventual trusted Rust adapter | Decision | Local read/write | Sync attempt |
| --- | --- | --- | --- |
| First device, no local snapshot | `activation_required` | No | No |
| Online session but local snapshot absent | `snapshot_required` | No | No |
| Encrypted profile exists, key remains locked | `unlock_required` | No | No |
| Encrypted snapshot unreadable | `recovery_required` | No | No |
| Revocation already known on the device | `known_revoked` | No | No |
| Previously activated, native-unlocked cache, offline/expired token | `ready_offline` | Eligible | No |
| Native-unlocked cache, online and valid session | `ready_online` | Eligible | **Only** if a reviewed sync transport is ready |
| Untrusted/malformed/inconsistent evidence | `invalid_evidence` | No | No |

Even `ready_online` is **not an authentication result**. The `canReadLocal` and `canWriteLocal` fields are hypothetical presentation eligibility, not permission to call storage APIs. A future Rust core must validate profile identity, encrypted DB key and local unlock, enforce all access, and clear memory on lock/logout or profile switch. Frontend state must never become the enforcement point.

`canAttemptSync` is *not* confirmation of synchronization. It requires a reported online network hint, a valid session **and** `syncTransportReady=true`. The experimental Desktop currently has no such transport. Pending mutations are shown only from a native-unlocked profile; for locked/invalid states `knownPendingMutations=null`, which means **unknown**, not zero or synchronized. Even a known zero is not a server ACK.

## Threat and lifecycle boundaries

- A disconnected computer cannot learn of a remote revocation that has not yet been delivered. The model denies access when revocation is **known**, but cannot promise immediate remote revocation against an offline device. The eventual product policy must explicitly decide how local unlock and optional offline grace periods behave.
- `network` is a UI/network hint, not a verified server connection. Future transport must independently handle TLS, expiry, per-user authorization, device revocation, idempotent mutations and conflicts.
- A corrupted cache requests recovery, **never plaintext fallback**. Do not implement plaintext private storage, load real birth records into this helper, or expose keys, profile IDs, file paths or personal data through this contract.
- This code has no IPC command, cryptography, database, keychain, internet calls, log output, UI wiring, update mechanism or secrets. It does not change existing Tauri capabilities.
- Version 1 uses a strict, closed input schema. Changes require a new reviewed protocol version, not silently accepting extra fields.

## Verify

```sh
node --experimental-strip-types --test tests/offline-profile-gate.test.mjs
npx --no-install tsc --noEmit --strict --target ES2022 --module ES2022 --moduleResolution bundler --lib es2022,dom src/app/native/offline-profile-gate.ts
```

Locally executed against a standalone copy with Node 22.16.0 and TypeScript 5.8.3: **13/13 focused tests passed** and standalone strict type-check passed. The tests exercise first login, snapshot absence, lock, corruption, online/offline token behavior, unavailable sync, revocation, schema failure, malicious accessors, and detached immutable results. Full repository npm/Angular/Cargo/Windows testing was **not** run.

## Next acceptance steps

1. Implement independently reviewed SQLCipher/OS-wrapped key access and profile isolation in Rust (separate storage branch); never use this TS decision as native authorization.
2. Define a minimal, versioned, native-attested *status-only* IPC boundary after the security and capability reviews. No arbitrary SQL, paths, or key material in the WebView.
3. Wire localized status to the app only after real native evidence exists. Keep the current synthetic UI status truthful until then.
4. Test Windows startup offline after prior activation, locked cache, corruption, logout/account switch, delayed revocation and pending edits; independently verify native authorization and conflict-safe sync when available.

No merge, GitHub Actions, deployment, public repository release or production touch is part of this slice.
