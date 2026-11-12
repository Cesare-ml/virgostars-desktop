# Angular ↔ Rust live calculation pipeline — performance contract

**2026-11-11 / Architecture proposal and benchmark gate. NOT an implemented calculation bridge.**
Priority: real-time `Adesso`, time correction (+/− year/month/day/hour/minute), hold-repeat, live transits. End-to-end must run without network or VirgoStars login.

## Separate four clocks and workloads

1. **Human interaction clock:** pointerdown/tap/keyboard/hold/drag events update a desired time. May arrive much faster than any astronomical solver. Never spawn one uncancellable native computation for each DOM event.
2. **Display clock:** `requestAnimationFrame` renders from the most recent **validated** astronomy snapshot and updates the textual desired instant immediately. UI animation may be 30/60 fps based on display/hardware, but does **not** imply 30/60 full Rust ephemeris computations per second.
3. **Calculation clock:** coalesced, bounded, cancellable/latest-only requests to a Rust worker; accurate outputs with declared availability, uncertainty and provider version. The worker must not block the Tauri event/UI thread.
4. **Real-time clock:** wall-clock updates using OS time, periodic recalibration after sleep/clock changes, and an explicit snapshot freshness indicator. Rendering never trusts frame count as elapsed civil time.

## Contract v1 (proposed; names not yet committed to code)

`ChartCalculationRequest`:
- `protocolVersion`, `sessionId` and increasing `requestSeq`; optional `batchId` for timeline prefetch.
- `intent` = `now|scrub|preview|committed|transit`; priority and cancellation token.
- UTC timestamp as a canonical instant, plus original local civil fields, timezone ID and disambiguation for DST; geolocation as typed degrees, latitude/longitude with range checks; accuracy/mode/houseId, requested bodies, ephemeris time-scale/provider options.
- `natalAnchorId` / stable snapshot version where applicable. Natal and transit input sources must remain separate.
- `calculationKey` = stable hash of **actual calculation-affecting** inputs, not skin, language, zoom or hidden chart labels.
- `settingsCalculationVersion` and a separate `renderSettingsVersion`; changing only colors must not recompute ephemerides.

`ChartCalculationResponse`:
- Exactly the same `protocolVersion`, `sessionId`, `requestSeq`, `calculationKey`, actual `computedUtc`, `providerVersion`, kernel/source version and quality/warnings.
- Compact typed planet/point arrays and house cusp/axis values with identifiers, not repeated names or arbitrary UI structures. Fixed-size/typed-array binary transport may be considered *only if profiling shows JSON serialization is a bottleneck*. No premature unsafe FFI.
- Explicit unsupported/unknown-time/polar-house/timezone statuses; no fabricated positions or silent fallback.
- Separate per-frame optional aspect results from `astrological-functions`. That package consumes Rust ephemerides and is the astrology domain layer; Rust remains the single astronomical authority. Avoid recalculating aspect geometry in both places.

Never rely on a response arriving in submission order. An older success/error must not overwrite a newer desired timestamp.

## Scheduling and backpressure

- Angular collects click/hold/drag into one `desiredTime` signal. Use a short coalescing window tied to `requestAnimationFrame` or a small trailing delay, with an **immediate visual time-label update**. This keeps input responsive even when astronomy lags.
- **At most one calculation actively in flight per chart lane and one latest-pending time request**, or a comparably bounded native scheduler. Every new scrub step replaces obsolete pending work. Production implementations may use one priority lane for committed work, but every lane must have a documented finite capacity.
- Do not enqueue unlimited `invoke()` promises, results, WebGL scenes, images or preload ranges. If Rust is busy, replace latest-pending; when done, submit only the newest request.
- Rust uses a dedicated worker/thread pool with finite concurrency and cancellation checks between expensive phases. `async` alone is not sufficient when computation is CPU-bound. Never lock the GUI or SQLCipher storage mutex during a whole calculation.
- `sessionId/requestSeq` and current screen/chart identity are checked on **both sides**. On change of mode, selected chart, settings, window destruction or logout, invalidate all stale requests and state. Native cancellation should reclaim CPU where safe; frontend invalidation prevents stale UI state even if cancellation races.
- A long hold must also handle `pointercancel`, mouse-up outside the window (pointer capture), blur, tab/window hidden, Escape, release during a pending request and rapid direction reversals.
- Retain only a bounded **LRU** for recent result snapshots, keyed by UTC/location/provider/house/system/settings version. Configure measured byte budget and TTL, not unbounded memoization. Evict old prefetch and dispose old Three.js textures/geometries/listeners when no longer owned.
- Batched evaluation may evaluate **a small, bounded set** of adjacent instants per Rust round trip if benchmarks show overhead dominates, never push thousands of frames. Ensure returned batch ordering IDs are verified.
- Do not interpolate astronomical positions as scientifically exact unless approved domain-specific interpolation is benchmarked with accuracy bounds, retrograde/station cases, cusp crossings, angular wrap and no unsupported-body fallback. A user can receive a time-label animation while the latest accurate chart catches up.

## Rendering strategy

- The renderer should expose a **stable incremental `updateChart(snapshot)`** pathway for frequently changing planet positions/aspect lines, rather than `ngOnDestroy()` + new WebGL renderer per tick. Preserve the chart camera, controls, selection and big centered canvas. Coordinate the upstream contract with `astrological-charts`; avoid duplicating Three.js code in Desktop.
- Keep the same Three.js scene / asset registry across updates, changing only geometries that actually differ; batch/reuse allocations where possible; inspect GPU resource counts after repeated updates and window close/reopen.
- Angular change detection should apply only the newest accepted snapshot, ideally outside unnecessary full-tree change detection. Prefer a worker for expensive aspect composition if needed; profile before selecting worker granularity.
- Two layers for radix+transits: immutable natal snapshot until the user edits it; transit snapshot updates on time changes. Cached natal positions must not be recomputed for every transit frame.
- Support reduced-motion: no forced interpolation/automatic animations; provide accessible exact numeric output and a visible loading/preview indicator.
- Distinguish `time being explored`, `time last computed`, `rendered snapshot time` and `saved birth time`.

## Candidate benchmark targets (NOT measured, NOT promises)

These are first **engineering hypotheses** to check on an ordinary supported Windows laptop and the maintainer's workstation:
- Pointer/timestamp interaction remains responsive, target first text feedback within one presentation frame (`16–33 ms) under a rapid hold.
- Smooth visual display target `30 fps or higher *where measured*; **do not** equate display fps with scientific evaluations per second.
- Native IPC overhead and transfer bytes/frame recorded with p50/p95/p99; choose a justified calculation sample rate and drop policy after benchmarks.
- Hold for 60 seconds, execute at least 10,000 alternating time edits across varied steps, then 30-minute live mode. No increasing pending-request count, leaked subscriptions, WebGL contexts or monotonic unexplained RAM growth.
- Compare idle/peak RAM, process private bytes, Rust heap and WebGL GPU resources; set **numeric RAM/cache ceilings only after measuring** real builds and data. The initial implementation must have explicit bounds even before tuning.
- Test under power-saving modes, high-DPI scaling, offline/no-network state and re-enable from sleep; require accurate astronomical fixtures at every accepted result.

## Acceptance tests to build BEFORE feature enablement

1. Fake slow Rust calculator (e.g. 100–300 ms) + rapid 200-step hold: **last desired time wins**, at most fixed bounded calls/queue, old errors do not erase newest chart.
2. Press/release/cancel and background window: no stuck interval; timer teardown on window destroy.
3. Flip direction, chart selection and skin during pending results: no incorrect chart, selection or saved-record mutation.
4. Main chart frozen during transit scrub while transit ring updates. Verify correct aspects toward radix and inverse hover selection via chart interaction contract.
5. Real offline compute parity with approved numerical fixtures, including house methods, retrograde stations, aspect-orb boundaries, leap day, time-zone gap/fold, longitude 0°/360° and extreme latitudes.
6. Repeated asset and scene cleanup, WebView2 context loss/resume, memory monitoring with recorded baseline and regression threshold.
7. Benchmark IPC with compact JSON vs optional packed arrays, cache on/off and short batch on/off; choose by data, not speculative micro-optimization.
8. Test that loss of a kernel/provider results in clear "unavailable" and no false live sky positions, never a network fallback without explicit consent.

## Cross-repository ownership

| Repo | Owner of change |
| --- | --- |
| `VirgoStars-Ephemeris` | Rust astronomical solver, time-scale conversion, ephemeris kernels, measured batch/cancellation capabilities |
| `astrological-functions` | Zodiac, houses/astrological composition and aspects according to its documented boundary; no duplicate astronomy |
| `astrological-charts` | Versioned low-allocation partial updates, pan/zoom and native-event/hover selection, scene/resource lifecycle |
| `virgostars-desktop` | Worker queue, typed Tauri IPC, time controls, guest persistence, live clock, UI status and profiling |
| `astrological-assets` | Approved symbol images only; never download private graphics during live rendering |

## Next coding slices, independent of real ephemeris readiness

P0-IPC-1: **Implemented in source and isolated tests:** pure TypeScript [LatestCalculationScheduler](LATEST_CALCULATION_SCHEDULER.md) with a synthetic transport, one active + one latest pending request, session invalidation, response echo verification and 10,000-submission overload tests (10/10 passing). **No real Rust invocation or chart animation yet.**

P0-IPC-2: The [synthetic CPU-only Rust Tauri command](SYNTHETIC_NATIVE_CALCULATION_PROBE.md), strict TypeScript adapter and [development-mode benchmark inspector](DEVELOPMENT_IPC_BENCHMARK.md) are now authored. The 24-call sequential benchmark reports real p50/p95/p99 and a separate worker-only time when actually run natively (8/8 pure Node tests passed locally); Rust release mode rejects the command. **Windows native build/round-trip and actual latency measurements remain required**. Do not show synthetic results as charts.

P0-IPC-3: A [strict experimental `first_sky` Angular DTO/decoder](FIRST_SKY_EXPERIMENTAL_CONTRACT.md) is now written, with source identity, unverified geometric quality, provider/kernel provenance, IERS date window, and all approximation warnings. **It is deliberately `chartEligible:false`** and contains no calculation algorithm. Only after independent NASA/JPL validation and a real bounded native Rust adapter can we connect a separately validated provider plus `astrological-functions` and enable `Adesso`.

P0-IPC-4: Implement renderer partial-update API and a stress test in WebView2, verifying the center chart stays large and resources return to baseline.

References: [OFFLINE_FIRST_MVP.md](OFFLINE_FIRST_MVP.md), [ROADMAP.md](ROADMAP.md).

**Do not assume the current `desktop_runtime_info` IPC is an astronomical calculator:** it only reports synthetic demo capabilities and currently has `ephemerisReady=false`.
