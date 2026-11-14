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

## Stale asynchronous status reads (UI-only lifecycle)

`src/app/native/latest-profile-status.ts` adds `LatestProfileStatus<TDecision>`,
an opaque-token **latest-only publication guard** for a future UI status request.
It is deliberately independent of the network/native transport, does not
schedule requests and does not grant access itself. Callers should combine it
with the v1 validator:

```ts
import {assessOfflineProfileAccess} from './offline-profile-gate';
import {LatestProfileStatus} from './latest-profile-status';

const guard = new LatestProfileStatus(
  assessOfflineProfileAccess,
  assessOfflineProfileAccess(null), // always-blocked fallback
);
const ticket = guard.begin(); // immediately blocks a previous ready state
// The caller may eventually await a *separately reviewed* native status source.
// If that future status read resolves: guard.complete(ticket, rawStatus);
// If it rejects: guard.complete(ticket, null) -> invalid_evidence.
// On lock/logout/account change: guard.invalidate() *synchronously*.
// On view destruction: guard.dispose().
```

`begin()` returns a unique symbol token, including across separate view
instances. Only its **single newest** unconsumed token may publish a decision.
Late, duplicate, wrong-view or post-logout replies are ignored. An assessor
exception yields the supplied blocked decision without logging private details.
Reentrant `begin()`/`invalidate()`/`dispose()` during assessment cannot
publish an obsolete ready status. The return value of `complete()` only
indicates that a completion was consumed, **not** that the evidence passed
validation, authentication or encryption checks.

**Security caveat:** This guard owns no I/O, cancellation, timeout, per-account
authorization or concurrency limit for already-running native calls. It prevents
obsolete **UI presentation** only. Future native/Rust storage code must
independently close old profiles and revoke keys on account switches, even
if the WebView receives an obsolete status callback. A new `begin()` must
not be invoked to enable reads without real native authorization.

### Executed focused checks (Node.js 22.16.0 / TypeScript 5.8.3)

```sh
node --experimental-strip-types --test tests/latest-profile-status.test.mjs
tsc --noEmit --strict --target ES2022 --module ES2022 --moduleResolution bundler --lib es2022,dom src/app/native/latest-profile-status.ts
```

**10/10 Node tests passed**, including 10,000 rapid refreshes, two out-of-order
promise completions, cross-instance token isolation, logout, reentrant invalidation,
throwing assessments and disposal. Standalone TypeScript strict compilation passed.
Exact committed source and test blob SHA-1s were confirmed against the local
Node-tested copy. These checks **do not** validate Tauri, SQLCipher, Angular,
native cancellation, session revocation or full npm suite.

## Bounded status refresh scheduling (mock-only follow-up)

`src/app/native/offline-profile-reader.ts` now supplies
`LatestOfflineProfileReader<TDecision>`. It consumes the existing
`LatestProfileStatus` through a narrow structural port (no runtime module
import), accepts an injected asynchronous status-only reader, and publishes
decisions through a best-effort subscriber.

- Each `refresh()` immediately blocks the prior presentation and schedules
  at most **one in-flight** read plus **one replaceable latest pending** read.
  Consecutive same-turn refreshes coalesce before invoking the port.
- A newer refresh requests `AbortSignal` cancellation, but the previous
  request's answer is never shown even if the port ignores that signal.
  Native requests are **not assumed cancellable**.
- On lock/logout/profile switch, call `invalidate()` synchronously to abort
  active work, discard pending work, and block visible status. Call `dispose()`
  at view teardown. Late answers or errors cannot revive the UI.
- Port rejection is passed as null to the injected v1 assessor, producing
  the blocked decision, and subscriber exceptions are isolated without
  displaying potentially sensitive diagnostic strings.
- **Deliberate safety trade-off:** if an abort-ignoring port never settles,
  the pending request cannot start and the UI remains blocked. This is safer
  than launching unbounded native requests. The real Rust adapter must have
  its own cooperative cancellation, bounded execution time and resource
  accounting; this TypeScript class does **not** guarantee eventual refresh.

Illustrative call wiring, **not** a working production IPC adapter:

```ts
const gate = new LatestProfileStatus(
  assessOfflineProfileAccess,
  assessOfflineProfileAccess(null),
);
const reader = new LatestOfflineProfileReader(
  gate,
  async signal => fakeTestOnlyStatusRead(signal), // ONLY a synthetic mock
  decision => renderFutureUiStatus(decision),
);
// reader.refresh() is an eligibility check, NEVER native authorization.
// reader.invalidate() must run on real lock/logout/profile switch.
```

The methods must not be used to fetch, authorize or persist birth records.
Only a separately audited Rust-owned encrypted profile lifecycle may read
actual sensitive data. This helper adds no IPC permissions, user credentials,
services, logging or actual native storage.

### Executed focused verification

```sh
node --experimental-strip-types --test tests/offline-profile-reader.test.mjs
tsc --noEmit --strict --target ES2022 --module ES2022 \
  --moduleResolution bundler --lib es2022,dom \
  src/app/native/latest-profile-status.ts src/app/native/offline-profile-reader.ts
```

On **Node.js 22.16.0**, 11/11 new asynchronous mock tests passed in a
standalone source mirror. TypeScript strict compilation also passed.
Scenarios cover 10,000 rapid refreshes, same-turn coalescing, abort-ignoring
readers, out-of-order replies, logout, disposal, never-settling transports,
rejected/invalid replies and reentrant notification. Exact new source and
test SHA-1 blobs match the GitHub branch: `299562f70312ef0d35e251ec3ff6494bdda96971`
and `1ac452516a873d02f79fa383ae53bce546dc3ac4`.
The existing guard is represented by an equivalent standalone local copy,
not a full checkout. **Not executed:** full npm/Angular suites, Rust/Cargo,
real native IPC, SQLCipher, real profiles, Windows/WebView2 acceptance.

## Fail-closed deadline for unresponsive status ports

The `LatestOfflineProfileReader` now supports an optional local deadline
(default **4,000 ms**, accepted explicit range **1–30,000 ms**). Its injectable
`OfflineProfileReaderTimers` supplies `schedule` and `cancel` for deterministic
tests. If the port misses this deadline, the reader aborts its `AbortSignal`
and publishes the supplied **blocked** decision rather than a false status.
The timer is cleared after a normal completion, a newer request, logout,
profile change or disposal; a scheduler that throws, fires synchronously
or returns a missing handle fails closed without invoking the native port.

**Resource-safety distinction:** the timeout does **not** mean a native call
terminated. The existing `active` slot is deliberately retained until its
actual returned promise settles. A native adapter ignoring cancellation can
therefore block a later pending read indefinitely, rather than launching
unbounded calls. Only a separately reviewed Rust-side cancellation/deadline
design can guarantee recovery. There is no network retry or automatic re-open
in this UI helper. `complete()` and the resulting decision are not a security
authorization, not a cryptographic attestation and not proof of a cloud session.

Example for a **synthetic-only** mock:

```ts
const reader = new LatestOfflineProfileReader(
  gate,
  async signal => fakeTestOnlyStatusRead(signal),
  decision => renderFutureUiStatus(decision),
  {timeoutMs: 4000},
);
```

Focused verification ran in a standalone local source mirror:

```sh
node --experimental-strip-types --test tests/offline-profile-timeout.test.mjs
tsc --noEmit --strict --target ES2022 --module ES2022 \
  --moduleResolution bundler --lib es2022,dom \
  src/app/native/offline-profile-reader.ts src/app/native/latest-profile-status.ts
```

**13/13 actual Node 22.16.0 tests passed** and standalone TypeScript 5.8.3
strict compilation passed. They exercise deadline expiry, no duplicate native
calls under a hanging port, 10,000 rapid refreshes, timer cleanup, timeout
and logout races, invalid timeout values, synchronous/throwing timer adapters
and failure before native invocation. The exact locally tested new source
and test files match GitHub Git blob hashes:
`35f090c4c4b4da0fa9128e61230d1ad72886b7c5` and
`1c8b6cb01b72728a0edeac69e299af699fdc2ea2`.

**Not executed:** the full repository npm test suite, Angular UI build,
Rust/Cargo tests, native SQLCipher, actual Tauri IPC, Windows WebView2 or
any real profile/account test. None of those is implied by this focused check.

## Bounded reentrant UI notifications

The status reader now also protects against a synchronous UI subscriber that
calls `refresh()`, `invalidate()` or `dispose()` while handling a status
notification. Instead of recursively notifying itself until the call stack
overflows, `emit()` delivers at most **one coalesced follow-up** after the
original notification. This preserves the important ready → blocked
notification sequence when the observer locks a profile in response to an
asynchronous status update. A pathological subscriber that invalidates on
*every* notification is bounded: further nested notifications are dropped
for that emission, while the final decision remains available via
`reader.decision`. Future UI wiring must consume the current decision,
rather than assuming every intermediate state is delivered.

Focused local check on exact current GitHub source:

```sh
node --experimental-strip-types --test \
  tests/offline-profile-notify.test.mjs tests/offline-profile-timeout.test.mjs
tsc --noEmit --strict --target ES2022 --module ES2022 \
  --moduleResolution bundler --lib es2022,dom \
  src/app/native/latest-profile-status.ts src/app/native/offline-profile-reader.ts
```

**18/18 Node tests passed** (five new notification tests and 13 existing
deadline tests), plus TypeScript 5.8.3 strict compilation, in the
synthetic local source mirror. The local Git object hashes were verified
against GitHub for source
`4e771fbb1f34b9eab310251c71e40454db1b212f` and regression tests
`2a4aafa798252405116e59b0b7a9c87b03c22c3a`.
The full repository test suite, Angular build, native Rust/SQLCipher,
and Windows WebView2 integration were **not** executed.

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
