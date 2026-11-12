# Development-only IPC benchmark — local Angular ↔ Tauri response times

**Status (2026-11-12): implemented in draft PR #30; the native Windows WebView2 round trip has NOT been run.**

## Purpose

A private developer can open **Parametri / Settings** during an Angular **development-mode** Tauri session and run a bounded synthetic IPC benchmark. This does not calculate planets, resolve historical birth times, read the 1,951,599-city catalog, access SQLCipher, render charts, synchronize an account or generate any personal data.

There are **two independent safeguards** against production exposure:

1. Angular creates the diagnostic component only when `isDevMode()` is true, using `*ngIf="showDevDiagnostics"`. It is not a regular chart feature.
2. The Rust command `synthetic_calculation_probe` returns `SYNTHETIC_DISABLED` when `cfg!(debug_assertions)` is false. A release-mode WebView cannot successfully invoke the worker even if a caller bypasses the UI.

The existing synthetic chart remains untouched. No change to CSP or `withGlobalTauri` is required.

## Code and limits

- `src/app/native/synthetic-ipc-benchmark.ts`: deterministic developer probe, no local/remote storage. Runs **24 sequential** calls by default, with `seed=17` and `iterations=10,000`. In general the controller bounds plans to 1–64 samples and 1–200,000 iterations, and refuses another run while one is active.
- `src/app/dev-ipc-diagnostics.component.ts/html/css`: development-only in-app panel with **Run**, **Stop**, progress and metrics. Cancels future calls on tab destruction/stop. The currently executing Rust operation is allowed to settle because JavaScript cannot reclaim a running native CPU worker; the worker itself has a strict iteration limit.
- `src/app/native/synthetic-calculation-transport.ts` + `src/app/native/synthetic-calculation-tauri.ts`: typed Tauri invoke with echoed session, sequence and calculation key. Only the synthetic marker and checksum are accepted.
- `src-tauri/src/synthetic_calculation_probe.rs`: globally at most 2 concurrent Rust blocking workers, each with no more than 200,000 fixed arithmetic iterations; disabled in release.
- `tests/synthetic-ipc-benchmark.test.mjs`: 8 pure benchmark tests, run and passed with Node 22.16.0, TypeScript 5.8.3 strict check passed on the exact same committed source. `tests/dev-ipc-diagnostics-source.test.mjs`: 5 source-contract tests authored for release guard, development-only display, bilingual copy and separation from birth/astronomy inputs; these must be run on a full checkout.

## What the numbers mean

The UI presents **p50 / p95 / p99** as nearest-rank percentiles of completed samples only. Two distinct measurements are reported:

- **Full round-trip (ms):** measured by `performance.now()` in the WebView around a native call. Includes IPC transport, asynchronous scheduling, deserialization and bounded synthetic work; it does **not** measure GPU chart rendering or actual ephemeris accuracy.
- **Worker time (ms):** the Rust worker's self-reported `workerMicros/1000`. Does **not** include serialization, queued time or UI-frame latency.

The latest synthetic checksum and completed count are shown as reproducibility checks. Benchmark cancellation and errors report the exact number of completed samples; they never display invented percentiles when no sample succeeded. A test with only 24 samples has limited statistical confidence, especially for p99; treat it as a local diagnostic, not a performance certification.

The benchmark is **sequential by design** (at most one outstanding IPC call). The independent `LatestCalculationScheduler` already has separate 10,000-submit load tests for its one-active/one-latest-pending policy. The diagnostic does **not** demonstrate cooperative cancellation of a real Rust ephemeris operation.

## Windows acceptance

In a development checkout of branch `feat/native-offline-place-search-001`, with required Angular/Tauri dependencies installed:

```powershell
npm.cmd test
npm.cmd run build:ui
cd src-tauri
cargo fmt --all -- --check
cargo test
cd ..
npm.cmd run tauri:dev
```

Open the right-hand **Parametri** tab, find **Diagnostica IPC**, click **Avvia 24 richieste**. In the native development app, record observed p50/p95/p99, worker-only values, CPU/RSS, behavior on Stop, and the build's toolchain/OS; avoid recording private desktop paths or subjects. Browser preview should say that native diagnostics are unavailable. Confirm the panel does not appear in a production Angular build and the Rust release command returns `SYNTHETIC_DISABLED`.

**Not yet performed:** full Node suite in checkout, Angular template/compiler validation, Rust unit tests or format, real Windows native round trips, release-mode UI security check, CPU/GPU/RSS benchmarking. The local authoring environment has no Rust toolchain. Do not report actual millisecond measurements until the above native test runs.

## Next step after acceptance

Integrate a **separate**, numerically verified Rust `VirgoStars-Ephemeris` provider with bounded work and cancellation, and connect its outputs to `astrological-charts`' incremental Three.js update contract. The benchmark cannot act as a substitute for astronomy or authorize saving unverified natal calculations. No GitHub Actions, no main merge and no deployment.
