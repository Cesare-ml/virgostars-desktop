# D-01 — Bounded latest-only calculation queue (prototype)

**Status: Locally tested pure TypeScript helper; NOT native IPC, astronomy, or a live chart integration.**
**Scope:** first independent prerequisite for the offline-first live-calculation pipeline described in draft PR #22 (`docs/LIVE_CALCULATION_PIPELINE.md`).

## What exists

`src/app/native/calculation-queue.ts` provides `LatestCalculationQueue<T>`, an injected async calculation port, a versioned request envelope, strictly correlated result decoding, and a snapshot validator chosen by the future real provider integration.

**Bounded scheduling:** one active request and **one replaceable latest pending request**, regardless of how often the user scrubs year/month/day/hour/minute controls. A newer valid request supersedes older work, aborts the active call via `AbortSignal` when possible and suppresses an obsolete success/error even if a native adapter ignores cancellation. After the active request settles, the queue submits only the latest pending request. The queue owns no timer, cache, worker, WebGL objects or network connection.

**Strict session identity (2026-11-14, stacked draft):** a calculation queue now requires `sessionId` to be an actual primitive string of 1–80 ASCII letters, digits, `_` or `-`. Previously `RegExp.test` could coerce a non-string such as a number, boolean, array or custom object into an apparently valid identifier. The strict type guard rejects these without calling user-defined `toString` methods, and keeps the original ASCII and length bounds. This protects local request/reply correlation only; it is not user authentication, a secret or an authorization token.

**Request contract v1:**
- `protocolVersion=1`, per-view `sessionId`, increasing `requestSeq`, and caller-provided stable `calculationKey`.
- `intent=now|scrub|preview|committed|transit`.
- Canonical millisecond `utcIso` (UTC `Z`); WGS84 latitude and longitude in integer microdegrees; an `Intl`-recognized IANA time zone ID.
- The `calculationKey` is currently an **opaque correlation key**, not an implemented hash; the eventual caller must generate it from *all* calculation-affecting settings and input identity, never display-only colors or language.

**Detached draft preflight (2026-11-13):** The queue now reads the six calculation-affecting fields exactly once into a new plain object, validates that same snapshot, and constructs the native request only from those validated primitives. A mutable/accessor-backed UI draft cannot pass validation with one value and enqueue a different one. A throwing or revoked proxy fails closed without consuming a sequence number or superseding valid in-flight work. This does not authenticate requests or guarantee that a future native provider will honor cancellation.

**Native reply snapshot (2026-11-13, stacked draft):** `decodeCalculationReply` now reads the version/session/sequence/key/status of a native reply at most once each. Only a correlated `ready` reply causes the provider version and snapshot to be read, also exactly once. Getter/proxy failures, revoked proxies and throwing validators return sanitized `invalid_reply` even when the decoder is called directly. `unavailable` and `unsupported` never cause access to arbitrary reply payload properties. This is a shallow, synchronous transport-boundary check; it does **not** deep-clone or cryptographically authenticate numeric snapshots. A future provider-specific validator must enforce the required schema and immutability/ownership before results are used by the chart.

**Immutable request envelope (2026-11-13, stacked draft):** after draft fields are detached and validated, `LatestCalculationQueue.submit` now freezes the new request object before giving it to an injected provider, placing it in the pending slot, or sharing it with a result observer. Its v1 fields contain only immutable primitives, so a shallow `Object.freeze` protects all request metadata against downstream modification. A provider that attempts to assign to frozen fields in strict mode fails as a sanitized `transport_error` without corrupting the queue; subsequent requests can proceed. This is an in-process correlation integrity guard, **not** cryptographic authentication, native process isolation, or server-side authorization. It does not freeze provider snapshots.

**Reply behavior:** protocol/session/sequence/key mismatch, unsupported version, malformed `ready` payload or failed injected snapshot validation gives `invalid_reply`; errors from the future provider are sanitized to `transport_error`. Explicit `unavailable` and `unsupported` are forwarded without leaking raw payloads. Only validated `ready` values reach the consumer. The request envelope is independent of Tauri; it can also drive an offline pure test adapter. Nothing is enabled or wired into the current chart yet.

**Safety boundaries:** no fake astronomy, no fallback to Swiss, no ephemeris kernel packaging, no user accounts or birth data, no token storage, no cloud/back-end change, no hidden network calls or privileged Tauri commands. `AbortSignal` alone does **not** cancel native CPU work; a future dedicated Rust worker must implement bounded scheduling and cancellation checkpoints separately. A hung port can delay pending work (at most one remains queued); a native timeout/restart policy must be reviewed with the actual adapter rather than introducing unbounded retries here.

## Lifecycle hardening: aborted preflight and stale validation (2026-11-12)

A race in the initial D-01 scheduler allowed its already-scheduled microtask
to invoke a provider **after** the view was disposed, or to invoke an obsolete
request when many same-turn corrections superseded it. The request envelope
was invalidated, but the unnecessary native work could still begin.

This was corrected without adding timers, retries, buffers or external state:

- Before invoking a provider, verify that the instance is alive, the
  `AbortSignal` is not aborted, and the generation/sequence still match the
  latest desired request. When a request is superseded before dispatch, skip
  that provider invocation entirely and let the existing one-slot pending
  scheduler launch the latest request.
- After a provider returns, perform the same validity check **before**
  decoding/validating the reply. Obsolete results must not run a potentially
  expensive snapshot validator or produce user-visible events.
- A custom snapshot validator that throws is converted to `invalid_reply`,
  with no exception details exposed. Later calculations still run.
- This is frontend scheduling only; it does **not** interrupt an already
  executing CPU-bound Rust task. Native cooperative cancellation remains
  a separate acceptance gate.

**Actually executed:** the entire D-01 Node suite passed **11/11**, including
four new regression tests for dispose-before-dispatch, same-turn replacement,
no obsolete validator work and validator exception recovery. Combined with
the D-02 mocked/native-source tests from PR #48: **20/20 passed** on
Node 22.16.0. Strict standalone TypeScript 5.8.3 compilation also passed.

No full Angular build, real Windows Tauri runtime, native Rust execution or
scientific ephemeris computation was performed in this validation.

## Checks actually run (Node 22.16.0 / TypeScript 5.8.3)

```sh
node --experimental-strip-types --test tests/latest-calculation-queue.test.mjs
# 7 passed, 0 failed
npx --no-install tsc --noEmit --strict --target ES2022 --module ESNext \
  --moduleResolution bundler --lib es2022,dom src/app/native/calculation-queue.ts
# passed
```

The tests include **200 rapid updates** and **10,000 rapid updates** with deliberately blocked asynchronous mock ports; they verify one active + last pending only, exact latest result, invalid data/replies, invalidation on teardown and sanitized rejected port errors. The synthetic mock snapshot is labeled `synthetic-only` and is never consumed by the desktop UI.

**Not run:** entire `npm test`, Angular build with the sibling Charts package, native Rust/Tauri tests, actual Windows WebView2 IPC, scientific numerical comparison or end-to-end frame/latency benchmarks.

## Integration order and open gates

1. Decide and pin a real, versioned Rust solver adapter contract (including provider provenance, frame, units, supported bodies, accuracy bounds, UTC→TT/TDB, kernel availability and unsupported statuses) against a tested `VirgoStars-Ephemeris` branch.
2. Implement a distinct Tauri native command on a **bounded CPU worker**; do not repurpose `desktop_runtime_info`. Both sides must verify session, sequence, calculation key and request provenance. Native cancellation requires its own cooperative checks.
3. Only after independent ephemeris accuracy evidence and an explicit `SnapshotValidator` for numeric output, connect the queue to Angular state and `astrological-functions` for chart-domain composition and `astrological-charts` for rendering. Never present synthetic fixtures as current sky.
4. Windows acceptance: run full tests and compilation, test real Tauri IPC and provider absence, 60-second rapid scrubbing, sleep/restart/teardown, multiple windows and bounded memory. Record actual hardware measurements.

## Concurrency and publication

This PR is an **independent, additive draft based on main** to avoid colliding with UI drafts #45/#46, the storage/SQLCipher chain and city-search PR #30. No merge, release, GitHub Actions, production modification or license/visibility change is authorized here. The repository remains private and license undecided.
