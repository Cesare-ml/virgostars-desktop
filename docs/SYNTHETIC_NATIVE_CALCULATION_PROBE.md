# Bounded synthetic native calculation probe — P0-IPC-2

**Implemented in source, 2026-11-12.** This is a CPU + Tauri IPC test fixture, **NOT** a VirgoStars-Ephemeris binding, and it must never be displayed as planets or natal/transit accuracy. It does not request or persist a birth date, location, personal note, account, database row or secret.

## Files and responsibilities

- `src-tauri/src/synthetic_calculation_probe.rs`: Tauri 2 command `synthetic_calculation_probe`. The input is a tiny synthetic integer seed plus bounded integer iteration count. It does deterministic 32-bit wrapping integer arithmetic on a blocking worker, returning a compact **syntheticOnly=true** fixture marker, 8-character checksum and `workerMicros` (the worker loop duration **only**, not round-trip IPC latency).
- `src-tauri/src/lib.rs`: separate native `SyntheticProbeGate` managed state and Tauri command registration. The existing local-city search gate and synthetic runtime capability probe remain independent.
- `src/app/native/synthetic-calculation-transport.ts`: typed v1 request/response adapter, strict data and echo validation, fail-closed browser mode. No forged planetary data can pass through as this fixture.
- `src/app/native/synthetic-calculation-tauri.ts`: official Tauri `invoke` / `isTauri` bridge. Not imported by the real natal chart UI.
- `tests/synthetic-calculation-transport.test.mjs`: 9 authored Node tests (eight behavior tests plus native source/registration contract), plus 5 Rust unit tests authored in the Rust source.

## Exact protocol

Tauri accepts `invoke('synthetic_calculation_probe', {request})`:

```json
{
  "request": {
    "protocolVersion": 1,
    "sessionId": "probe-1",
    "requestSeq": 1,
    "calculationKey": "synthetic-check",
    "input": {"seed": 17, "iterations": 10000}
  }
}
```

A response has exactly the echo fields plus a result shaped like:

```json
{
  "protocolVersion": 1,
  "sessionId": "probe-1",
  "requestSeq": 1,
  "calculationKey": "synthetic-check",
  "result": {
    "syntheticOnly": true,
    "fixtureKind": "synthetic_ipc_probe",
    "iterations": 10000,
    "checksumHex": "a1b2c3d4",
    "workerMicros": 180
  }
}
```

The example checksum and elapsed time are **illustrative placeholders**, not measured output. Do not use them as numerical golden vectors; repeat the same input on the same version of the pure Rust worker to compare actual checksums.

Constraints:
- Version **1** only, with session/key printable ASCII token of 1–128 characters.
- `requestSeq` positive and at most JavaScript's max safe integer.
- `seed` a u32; `iterations` **1–200,000**.
- Native concurrency: **at most 2 blocking workers globally**. Permit is acquired before spawning; additional requests fail immediately with `SYNTHETIC_BUSY`, not an unbounded task queue.
- `LatestCalculationScheduler` remains **one active + one replaceable pending** per front-end session and rejects old successes/errors.
- Rust input rejects unknown fields via Serde `deny_unknown_fields`. The TS adapter verifies the echoed session, sequence and calculation key and an exact synthetic marker, validates checksum and integer ranges, and only forwards approved keys.
- No native filesystem/network operations, no SQLCipher, no city catalog, no interop with Three.js or astronomy.

**Important limitations:** a blocked or crashed provider cannot currently be cancelled by the scheduler; native work here is bounded by an intentionally small iteration budget. Real ephemeris must implement its own cooperative cancellation and worker deadlines. The worker microseconds do **not** measure browser event-to-render frame latency, native queue wait time or GPU memory.

## How to validate in Windows

From the correct draft branch `feat/native-offline-place-search-001`:

```powershell
npm.cmd test
npm.cmd run build:ui
cd src-tauri
cargo fmt --all -- --check
cargo test synthetic_calculation_probe
cargo test
cd ..
```

The existing Angular synthetic app is not automatically running this benchmark; a developer may import `nativeSyntheticCalculationProbe` and `LatestCalculationScheduler` into a *temporary approved test harness* to measure genuine native invocation:

```typescript
const scheduler = new LatestCalculationScheduler(
  'probe-1',
  nativeSyntheticCalculationProbe,
  {
    onResult: (response) => {
      // Development diagnostics only, never a chart update.
      if (response.result.syntheticOnly) console.log(response.result);
    }
  }
);
scheduler.submit({seed: 17, iterations: 10000}, 'synthetic-check');
```

Only use that snippet after importing both modules in a local development WebView2/Angular context. Browser-only use fails with `SYNTHETIC_NOT_NATIVE`, not a fake response. Never enable `withGlobalTauri`, inject arbitrary scripts, or expose personal chart data in the benchmark.

### Validation performed in the authoring environment

- **Eight of eight** behavioral Node tests on the adapter **passed** with Node 22.16.0; TypeScript 5.8.3 `--noEmit --strict` **passed**. Exact GitHub adapter file SHA should be recorded after read-back.
- The ninth Node test checks Rust registration/source and was authored but not executed in the isolated local test directory.
- Five Rust unit tests (determinism, malformed protocol, bounded global gate, camelCase Serde and unknown-field refusal) were authored. **Rust toolchain was unavailable here; none of the five Rust tests or a real Windows native round trip was executed.**
- The earlier pure scheduling suite was actually run 10/10 separately. Do not aggregate these into a false full end-to-end pass.

## Next gates

1. Run the Rust tests and full Angular/Node builds on the Windows development machine, record any compiler or runtime discrepancies, and inspect the generated executable's WebView2 console.
2. Measure synthetic round-trip p50/p95/p99 plus real CPU/RSS and queue bounds under a 60s press-and-hold, with Windows release build.
3. Replace synthetic work with a **separate and numerically tested** Rust VirgoStars-Ephemeris provider (with known kernels, supported date range and explicit unavailable states).
4. Let the upstream `astrological-charts` renderer apply validated incremental position snapshots without tearing down the Three.js scene; preserve chart/session IDs and stale-result suppression.
5. Reconcile stacked draft branches and commit locks before approved main merge; do not use GitHub Actions or modify production.

No personal or purchased data, no login, no network, no cloud fallback, no release and no main merge.
