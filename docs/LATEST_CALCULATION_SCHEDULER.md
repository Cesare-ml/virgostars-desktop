# Bounded latest-only calculation scheduling — implementation v1

**Status (2026-11-12):** a pure, generic TypeScript scheduler has been implemented and tested with synthetic transport. **There is no native astronomical calculation command, no real sky data, and no live chart animation in this change.** The existing synthetic UI is unchanged.

## Implementation

- `src/app/native/latest-calculation-scheduler.ts` defines a generic `LatestCalculationScheduler<I,O>` and versioned `CalculationRequest/CalculationResponse` contract with `protocolVersion=1`, `sessionId`, strictly increasing `requestSeq`, `calculationKey` and the caller's opaque typed input/output.
- Input clock and astronomical calculation clock are deliberately separate: `submit(input, key)` immediately replaces the sole **latest pending item**, returning only a sequence number, **not a new Promise per click**. The queue holds **at most one active provider promise plus one pending input**.
- **No unbounded native work:** while a provider call remains in flight, no more calls are dispatched. Even when Tauri `invoke` cannot interrupt an already-started Rust calculation, a 10,000-tick hold does **not** issue 10,000 `invoke` calls.
- Older success **or failure** is dropped unless its session, generation and sequence match the latest desired calculation. The response must echo the correct protocol version, session, sequence and calculation key; mismatches return a sanitized `PROTOCOL_MISMATCH` error to the current observer rather than overwriting a chart.
- `invalidate()` removes pending work and invalidates any active completion. `switchSession()` changes chart/workspace identity and invalidates everything from the previous session, even if the same chart is opened again. `dispose()` prevents future submissions and observer notifications.
- A failed/throwing transport or observer cannot permanently wedge the queue. Error observers receive sanitized codes, never the provider's absolute paths, SQL text, authentication headers or private birth fields.
- This controller keeps no cache of results, no WebGL scenes and no list of past requests. It is agnostic to birth time, unknown time and ephemeris kernel; validation of those fields belongs to the native provider contract and astronomical acceptance tests.
- It cannot forcibly reclaim CPU from a hung running Rust calculation; **cooperative native cancellation/deadline and bounded worker execution are separate required gates** before relying on live astronomy. Do not use `Promise.race` alone as a fake cancellation mechanism.

## What the downstream provider must implement

A future Rust/Tauri adapter must:
1. Refuse unsupported ephemeris, body, house or time ranges and missing kernel resources with explicit **unavailable** statuses, never synthetic positions masquerading as real.
2. Accept typed calculation inputs with a **validated UTC instant** (or explicit unknown-birth-time status), source geolocation, house/visible bodies and calculation-affecting settings. It must **not** use the city's current `tz_offs` for historical birth times.
3. Echo the stable protocol, session, sequence and calculation key. Return compact typed, numerically verified planet/house/aspect data and provider/kernel versions.
4. Perform CPU-heavy work in a bounded Rust worker with cooperative cancellation and safe wake/sleep behavior; never block the Tauri UI or SQLCipher archive mutex.
5. Offer incremental chart update integration through the **astrological-charts** API. Rendering frame rate and scientific sample rate are not the same, and no duplicate Three.js renderer should be built in Desktop.
6. Measure p50/p95/p99 click-to-frame latency, heap/RSS growth over a 60s hold and a 30-minute live session on ordinary Windows hardware. Do not claim memory/fps improvements based only on synthetic unit tests.

**Current editor integration:** the existing Nuovo tema +/- controls adjust the unsaved civil-time preview locally. They **do not call this scheduler** until there is an authoritative Rust calculator. This prevents a misleading preview from being presented as astronomy.

## Test record and reproducibility

In the 2026-11-12 authoring environment:
- `node --experimental-strip-types --test tests/latest-calculation-scheduler.test.mjs` → **10/10 passed**, Node.js 22.16.0.
- `tsc --noEmit --strict --target ES2022 --module ES2022 --moduleResolution bundler src/app/native/latest-calculation-scheduler.ts` → **passed**.
- Verified the exact GitHub source blob SHA `7a6639262e56aa6a82d83cc4da1fa291d2553eef` and test blob SHA `4d4e617a0e3f5ecdf6e54f9fe2c5b5cc216bd5e9` match locally executed files.
- Cases include **10,000 rapid submissions** accepted by the controller with only **two actual mock-provider calls** (first and latest), no stale result, session switch, invalidation/disposal, stale transport error, wrong-version/sequence/key response, error recovery and malformed input.
- **Not executed:** complete repository `npm test`, Angular/WebView2 production build, Rust `cargo test`, synthetic native Tauri IPC timing, actual ephemeris numerical checks or long-run OS memory/GPU measurements.

## Follow-up execution plan

- [x] P0-IPC-1: generic latest-only scheduler plus mock transport tests.
- [ ] P0-IPC-2: **bounded** native Rust synthetic deterministic IPC benchmark command, distinguish it clearly from a real ephemeris response, and test protocol parity/flow on Windows.
- [ ] P0-IPC-3: integrate only numerically validated `VirgoStars-Ephemeris` Rust calculations and time-zone authority; no Swift/Swiss-derived code or unsupported data.
- [ ] P0-IPC-4: connect exact outputs to incremental `astrological-charts` chart updates and real-time correction; preserve old graph until a verified snapshot arrives.
- [ ] Converge related stacked draft PRs safely, test with correct WebView2 CSS, obtain main merge authorization and record manual release gate.

No personal chart records, account credentials, purchased city rows or proprietary source were added. No deployment, GitHub Actions, merge, publication or UI promise of working live natal astronomy. See also [LIVE_CALCULATION_PIPELINE.md](LIVE_CALCULATION_PIPELINE.md), [NATAL_RAPID_CORRECTION.md](NATAL_RAPID_CORRECTION.md), and [ROADMAP.md](ROADMAP.md).
