# D-01 — Bounded latest-only calculation queue (prototype)

**Status: Locally tested pure TypeScript helper; NOT native IPC, astronomy, or a live chart integration.**
**Scope:** first independent prerequisite for the offline-first live-calculation pipeline described in draft PR #22 (`docs/LIVE_CALCULATION_PIPELINE.md`).

## What exists

`src/app/native/calculation-queue.ts` provides `LatestCalculationQueue<T>`, an injected async calculation port, a versioned request envelope, strictly correlated result decoding, and a snapshot validator chosen by the future real provider integration.

**Bounded scheduling:** one active request and **one replaceable latest pending request**, regardless of how often the user scrubs year/month/day/hour/minute controls. A newer valid request supersedes older work, aborts the active call via `AbortSignal` when possible and suppresses an obsolete success/error even if a native adapter ignores cancellation. After the active request settles, the queue submits only the latest pending request. The queue owns no timer, cache, worker, WebGL objects or network connection.

**Request contract v1:**
- `protocolVersion=1`, per-view `sessionId`, increasing `requestSeq`, and caller-provided stable `calculationKey`.
- `intent=now|scrub|preview|committed|transit`.
- Canonical millisecond `utcIso` (UTC `Z`); WGS84 latitude and longitude in integer microdegrees; an `Intl`-recognized IANA time zone ID.
- The `calculationKey` is currently an **opaque correlation key**, not an implemented hash; the eventual caller must generate it from *all* calculation-affecting settings and input identity, never display-only colors or language.

**Reply behavior:** protocol/session/sequence/key mismatch, unsupported version, malformed `ready` payload or failed injected snapshot validation gives `invalid_reply`; errors from the future provider are sanitized to `transport_error`. Explicit `unavailable` and `unsupported` are forwarded without leaking raw payloads. Only validated `ready` values reach the consumer. The request envelope is independent of Tauri; it can also drive an offline pure test adapter. Nothing is enabled or wired into the current chart yet.

**Safety boundaries:** no fake astronomy, no fallback to Swiss, no ephemeris kernel packaging, no user accounts or birth data, no token storage, no cloud/back-end change, no hidden network calls or privileged Tauri commands. `AbortSignal` alone does **not** cancel native CPU work; a future dedicated Rust worker must implement bounded scheduling and cancellation checkpoints separately. A hung port can delay pending work (at most one remains queued); a native timeout/restart policy must be reviewed with the actual adapter rather than introducing unbounded retries here.

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
