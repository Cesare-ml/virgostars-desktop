# Experimental VirgoStars-Ephemeris sky preview — typed boundary v1

**Status (2026-11-12):** a **pure TypeScript validation contract and test fixtures** have been committed to the draft desktop branch. **No Rust ephemeris crate is linked into Desktop yet; no command, calibrated physical accuracy, real chart or native Windows acceptance is claimed.**

## Grounding in the actual upstream Rust core

Verified `Cesare-ml/VirgoStars-Ephemeris`, branch `dev/ephemeris`, against `crates/ephemeris-core/src/first_sky.rs` and [first planet positions](https://github.com/Cesare-ml/VirgoStars-Ephemeris/blob/dev/ephemeris/docs/FIRST_PLANET_POSITIONS_2026-11-10.md):

- `first_sky::calculate(&mut De441, CivilTimestamp, Observer)` currently computes **experimental geometric topocentric directions** using a **privately supplied classic DE441 file**, IAU 2006 mean precession and WGS84 observer geometry. It is not yet the Swiss-equivalent *apparent tropical sky* and is **not independently validated end-to-end**.
- Existing `PlanetPosition` exposes **mean ecliptic longitude/latitude of date**, **mean RA/declination of date**, altitude, east-from-north azimuth (optional at zenith/nadir) and topocentric distance (km). It does **not** supply validated planetary angular speeds, apparent coordinates, astronomical houses, ecliptic nodes, interpreted aspects or fixed stars.
- Existing `Body` enum distinguishes `MarsBarycenter`, `JupiterBarycenter`, `SaturnBarycenter`, `UranusBarycenter`, `NeptuneBarycenter` and `PlutoBarycenter`. **Never label those system barycenters as the exact planet center**.
- Its IERS leap-second table supports UTC **from 1972-01-01 to before 2027-06-28** (IERS Bulletin C 72 expiry). Before enabling real computations beyond this interval, update and validate a newer authoritative time model. Earlier natal dates must produce `unsupported` rather than silently extrapolated positions.
- Known approximations: UT1=UTC, truncated TDB–TT, no nutation, no light time, no aberration, no gravitational deflection, no polar motion, no atmospheric refraction, and outer planet system barycenters.

**No upstream source was copied into this repository**; `first-sky-preview-contract.ts` only declares wire types and validates already-computed values. Astronomical algorithms remain in the Rust core.

## Draft Desktop IPC v1

`src/app/native/first-sky-preview-contract.ts` provides:

- `validateFirstSkyInput()`: checks a canonical millisecond UTC instant (no browser-local offsets), integer microdegree latitude/longitude, WGS84 height in metres, and a bounded, deduplicated list of upstream-supported bodies. The UI's historical IANA gap/fold resolver must supply the definitive UTC instant **before** this command can be invoked.
- `decodeFirstSkyPreview(raw, request)`: requires the exact echoed `protocolVersion/sessionId/requestSeq/calculationKey` to prevent stale/replayed results, a strict `provider: VirgoStars-Ephemeris`, `kernelFormat: classic_DE441`, 64-character lower-case SHA-256 kernel provenance, core version, computed UTC matching the request, full approximation disclosures and valid finite angular/distance bounds.
- The only accepted quality is `unverified_geometric`. The decoder returns `kind: experimental_geometric_preview` and **`chartEligible: false`**, explicitly preventing promotion to the authenticated, validated natal chart model. A response marked `syntheticOnly`, with a made-up frame or with `chartEligible: true`, fails closed.
- The decoder enforces **exact requested-body coverage**, without duplicates or guessed fallbacks. It rejects incorrect `Mars` aliases, missing azimuth semantics, infinite angles and out-of-range physical quantities. It copies only approved response fields, discarding untrusted extra properties.

The `kernelSha256` and `coreVersion` fields are **requirements for a future Rust IPC adapter**, not claims that the current `first_sky` API already emits them. The real bridge must compute/retrieve an accurate SHA-256 for a verified locally provided data file; never invent a digest or encode a private filesystem path into IPC.

**Important:** valid format is not proof of correct astronomy. The current types provide provenance/identity and prevent a broad set of UI/protocol mistakes, but **scientific validation requires independent NASA/JPL/Horizons vector comparisons and a deliberate future upgrade of quality/capability flags**. Do not change `chartEligible:false` based only on passing synthetic tests.

## Explicitly unsupported in this vertical slice

| Request | Required response |
| --- | --- |
| Date before 1972-01-01 or on/after 2027-06-28 | Unsupported time range, **no guessed planets** |
| Unknown or non-uniquely resolved local birth time | Resolve user choice first or report no exact UTC |
| Missing classic DE441 file | Missing resource, **no network fallback** |
| Apparent longitude, speed, houses, nodes, fixed stars, aspects | Unsupported; no fabricated values |
| Exact Mars or outer planet center where only barycenter is available | Unsupported or explicit barycenter label |
| Synthetic CPU benchmark result | Never accepted as an astronomical response |
| Astronomically incorrect but structurally plausible numeric output | Requires **independent scientific comparison**; structure validation alone cannot catch it |

## Tests and acceptance

`tests/first-sky-preview-contract.test.mjs` contains **18 authored Node tests** covering dates, observation coordinates, response envelope, barycenter identity, quality markers, kernel provenance, approximations, NaN/Infinity, geometry bounds and source-only decoding.

**Actually executed locally:** strict TypeScript compile and **15/15 smoke tests on an equivalent compact copy of the decoder**, Node.js 22.16.0. The committed full 18-case test suite has **not** yet been run against the full repository checkout; do not report it as passing. The experimental Rust crate and Windows Tauri native app were also **not built here**.

Next acceptance sequence on the maintainer's Windows checkout:

```powershell
npm.cmd test
npm.cmd run build:ui
cd src-tauri
cargo fmt --all -- --check
cargo test
```

Then, **only after scientific acceptance of `first_sky` on a real DE441 file**, implement a separate bounded Rust adapter, preserving the explicit experimental quality and all approximation warnings. Compare independent real-data numeric references, assess timescale/kernel limitations, and only then consider a distinct stable **validated** result contract and incremental `astrological-charts` rendering. Do not add a second TypeScript astronomy algorithm.

No real user birth data, purchased city rows, NASA kernel, user credentials or secret were placed into Git. No login, network, GitHub Actions, merge, deploy or publication.
