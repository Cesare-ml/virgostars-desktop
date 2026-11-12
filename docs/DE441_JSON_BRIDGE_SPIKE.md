# DE441 JSON bridge — isolated native Rust experiment

**Status (2026-11-12): Rust implementation written; 14/14 Node source + mocked-process smoke tests passed locally, using the real shared TypeScript receiver. Rust compilation, Cargo unit tests and a scientific calculation with a real DE441 file HAVE NOT been executed here (Cargo and the external kernel are unavailable).**

## Scope

The standalone package at experiments/de441-json-bridge calls the **original Rust VirgoStars-Ephemeris first_sky::calculate** function against a separately acquired classic, little-endian DE441 kernel. It serializes geometric topocentric results for ten bodies into the exact field names and units of the Desktop ExperimentalSkySnapshotV1 TypeScript receive contract. There is no astronomical algorithm copied to JavaScript and no new Tauri IPC command, chart activation, or production dependency.

The scientific source is pinned to the public VirgoStars-Ephemeris Git commit 042c004928d72f07827bd1a1ca3ab25bfb18ce09 (dev/ephemeris snapshot verified on 2026-11-12). Its code license is CPAL-1.0 with attribution provisions, distinct from the Desktop application's undecided license. There is no JPL file or external database included in this repository.

The default src-tauri/Cargo.toml and normal Windows build are **unchanged**. Only someone explicitly compiling this separate experiment fetches the pinned Rust dependency. There is no account, token, network calculation fallback, online backend call or personal birth record.

## Run it from a Windows development checkout

Prerequisites: Rust 1.90+ with Cargo, an authorized externally obtained classic DE441 file, and Node 22+. The first Cargo invocation may download code/dependencies while installing, but **the astronomical calculation itself is local and offline** once built. Review license and origin of your own DE441 file separately; its rights do not come from the source-code license.

From the desktop repository root:

    cargo test --manifest-path .\experiments\de441-json-bridge\Cargo.toml
    node --experimental-strip-types --test tests/de441-json-bridge-source.test.mjs tests/de441-json-bridge-smoke.test.mjs
    node --experimental-strip-types scripts/verify-de441-json-bridge.mjs 'D:\example\classic-de441.eph' '2026-11-12T17:01:02.000Z' 44123456 11345678 120

The example file path is fictitious. The five CLI arguments are: external file path, UTC instant with exactly millisecond precision and trailing Z, latitude in WGS84 microdegrees, longitude in WGS84 microdegrees east-positive, and height in meters. Source valid range for latitude is ±90 degrees, longitude ±180 degrees and height -12000 to 100000 meters. Unsupported dates are rejected; the current upstream IERS Bulletin C 72 leap-second table is supported only from 1972-01-01 UTC through 2027-06-27 inclusive.

On success, the wrapper prints only:

    DE441_SMOKE:SHAPE_VALID_EXPERIMENTAL_UNVERIFIED
    Scientific numerical accuracy, provenance rights and Tauri IPC remain unverified.

The wrapper invokes Cargo with no shell, parses the output, and applies the shared TypeScript scientific-snapshot validator. Before invoking Cargo it rejects non-canonical latitude/longitude/height numbers, impossible Gregorian UTC dates (including JavaScript-normalized invalid dates), and dates outside 1972-01-01..2027-06-27. Each call is bounded to a five-minute subprocess timeout and 64 KiB captured stdout/stderr buffer; timeout/oversize/failed Cargo results return only a sanitized unavailable code. This can fail closed on slow first-time Rust builds: precompile with `cargo build --manifest-path experiments/de441-json-bridge/Cargo.toml` if needed. It does not print private source file paths, coordinates, raw payloads or birth dates, even on failure. Running Cargo *directly* on a developer's terminal can still generate its ordinary compilation diagnostics.

## Model and provenance

The independent Rust core performs all celestial calculations and UTC→TT→TDB conversion. The bridge only maps existing Rust results to JSON with explicit labels:

- Scientific status: experimental_unverified, geometry topocentric_geometric, WGS84 observer; mean ecliptic/equatorial of date. **Not apparent positions or proven Swiss Ephemeris parity.**
- Body identities: Sun, Moon, Mercury and Venus as body_center; Mars, Jupiter, Saturn, Uranus, Neptune and Pluto as system_barycenter. Never represent the outer barycenter as the exact planet center.
- Values: longitude/latitude, right ascension/declination, altitude/azimuth in degrees, distance in kilometers, TT/TDB Julian days, integer TAI−UTC seconds, and latitude/longitude in integer microdegrees.
- Provenance: lowercase SHA-256 of the **actual external classic DE441 file opened**, not a typed hash or its filesystem path. The bridge opens a single read-only file handle, hashes the bytes, seeks to the beginning and calls De441::new on the same handle to avoid hashing a different file from the one opened for calculation.
- All nine known model approximations are explicitly listed, including UT1=UTC, truncated TDB−TT, absent aberration/light-time/nutation/refraction, and outer-system barycenters. Unsupported date/range, missing series, broken file or numerical failure produce only bounded error codes.

The JSON schema must be accepted by src/app/native/experimental-sky-contract.ts using the *same* UTC/observer request values. The wrapper checks this via isExperimentalSkySnapshotV1. Its success means only that the **shape** and declared limitations are compatible, not that numerical results are independently accurate or the kernel is legally redistributable.

**Performance limitation:** SHA-256 streams the whole potentially multi-gigabyte kernel once per *explicit CLI run*. A real-time Tauri provider must cache verified file identity and ephemeris records, run in a bounded native worker and support cancellation; it must not launch this CLI or rehash the kernel once a second. A local file that is modified in place during an active run is not protected by this proof of concept.

## Tests performed and not performed

Executed locally on Node.js 22.16.0:

- **5/5** source-contract tests in `tests/de441-json-bridge-source.test.mjs`, verifying the precise pinned dependency, ten body-center mappings, all nine approximations, required output metadata and isolation of native paths/Tauri.
- **9/9** process-level tests in `tests/de441-json-bridge-smoke.test.mjs` use the **actual script and committed TypeScript validator**, with a temporary fake `cargo` executable *only in a disposable test PATH*. They cover clean synthetic schema acceptance, invalid/normalized Gregorian UTC, IERS range, malformed numbers, missing Cargo, missing bodies, location/height mismatch, misleading 'validated' science claims, malformed JSON, private stderr suppression and oversized subprocess output. Mocked subprocess tests run on Unix/Linux/macOS; on Windows, the shell-free fake executable tests are skipped (preflight tests still run), and real Cargo acceptance is required separately. No real ephemeris file is read and no astronomical calculation is performed by this test suite.
- **Executed locally:** `node --experimental-strip-types --test tests/de441-json-bridge-source.test.mjs tests/de441-json-bridge-smoke.test.mjs` → **14 passed, 0 failed** (Node 22.16.0); `node --check` succeeded for both the smoke script and new test. The Git blob SHAs of the exact tested source files were verified against GitHub.
- These checks do not substitute for a compiled Rust binary, a real DE441 kernel run, independent JPL/NAIF comparison or a packaged Windows WebView2 test.

Not executed here: Cargo fmt/test/clippy, actual Rust compilation, full Node/npm suite or Angular build, an actual DE441 binary calculation, independent JPL Horizons/NAIF comparisons, WebView2, Tauri IPC and signed desktop distribution.

Before enabling any chart based on these data: run Cargo and actual kernel tests; capture an authentic independent JPL reference comparison with frame, time scale, observer, corrections and numerical tolerances; verify the file's provenance/usage rights; and design a **separate** native Tauri integration that obtains its kernel only from an approved local resource location. Never accept arbitrary kernel paths from the WebView.

## Relationship to drafts

This is an experimental, separately runnable tool added to draft PR #48, building on draft #47 and the preexisting receive-only sky validator. The current desktop_runtime_info and desktop_calculation_probe commands still report ephemerisReady=false / EPHEMERIS_NOT_INTEGRATED; the Angular chart remains visibly synthetic. No GitHub Actions, merge, release, production backend modifications, public visibility or new Desktop license is authorized in this step.
