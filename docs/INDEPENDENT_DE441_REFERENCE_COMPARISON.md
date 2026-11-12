# D-04 — Offline comparison against an independently normalized astronomical reference

**Status: Locally tested comparator; NOT scientific certification or a usable desktop ephemeris.**

This is a review-only prerequisite for replacing the `unavailable` Tauri probe. It sits beside draft PR #55's bounded, opt-in Rust DE441 smoke launcher; **it does not invoke the native bridge, integrate a kernel, or enable the chart**. No upstream astronomy algorithms are recreated in JavaScript.

## What the checker accepts

`node scripts/ephemeris/compare-de441-reference.mjs` reads three files **from the operator's machine only**:

1. `--actual`: a JSON `ExperimentalSkySnapshotV1` emitted by the *experimental* VirgoStars-Ephemeris Rust bridge (DE441 classic binary; ten named bodies). This remains labeled `scientificStatus: experimental_unverified`.
2. `--reference`: an independently produced **normalized reference JSON** (the format described below). This is not directly the raw JPL Horizons output: Horizons observations must first be converted by a separately reviewed and documented independent process into **exactly comparable** WGS84 topocentric *geometric*, mean-of-date coordinates. If the original query/corrections cannot be reconciled, **do not create a reference that claims equivalence**.
3. `--raw-source`: the original unmodified JPL Horizons response retained for provenance/audit. Its SHA-256 must equal the `reference.provenance.rawResponseSha256` field. The query and normalization implementation must also be preserved for external review; this tool only checks that their SHA-256 *strings are correctly formed*, not that their bytes are authentic or independent.

### Reference JSON v1

Required root keys (no extras): `schemaVersion`, `provenance`, `utcIso`, `latMicro`, `lngMicro`, `heightMeters`, `observerDatum`, `frame`, `geometry`, `ttJulianDay`, `tdbJulianDay`, `taiMinusUtcSeconds`, `approximations`, `positions`.

- `schemaVersion: 1`.
- `provenance` contains **exactly**: `source: "JPL_HORIZONS"`, `rawResponseSha256`, `querySha256`, `normalizationCodeSha256` (all 64 lowercase hexadecimal characters) and a printable, 20–400 character `normalizationNotes` field. Retain the raw query and independent conversion code outside this repository. These assertions do not attest authenticity.
- `utcIso` is canonical UTC millisecond ISO within the experimental 1972-01-01 to 2027-06-27 coverage; `latMicro`/`lngMicro` are east-positive WGS84 integer microdegrees; `heightMeters` is ellipsoidal height, from -12,000 to +100,000 m.
- `observerDatum: "WGS84"`; `frame: "mean_ecliptic_and_equatorial_of_date"`; `geometry: "topocentric_geometric"`. A geocentric, astrometric, apparent, true-of-date or differently corrected output is **not interchangeable**.
- `ttJulianDay` and `tdbJulianDay` identify the independently converted epoch; `taiMinusUtcSeconds` and the complete list of nine experimental approximation disclosures must match the actual snapshot. The checker does **not** itself implement or establish an accurate UTC→TT/TDB conversion.
- `positions` is a ten-item array with **one of each**: `sun`, `moon`, `mercury`, `venus`, `mars_barycenter`, `jupiter_barycenter`, `saturn_barycenter`, `uranus_barycenter`, `neptune_barycenter`, `pluto_barycenter`. Barycenter IDs **must not** be relabeled as planetary centers. Each entry uses the exact `ExperimentalGeometricPositionV1` keys: `bodyId`, `centerKind`, `longitudeDeg`, `latitudeDeg`, `rightAscensionDeg`, `declinationDeg`, `altitudeDeg`, `azimuthDeg`, `distanceKm`.

## Manual offline invocation

```powershell
node scripts/ephemeris/compare-de441-reference.mjs --actual .local/review/sky-experimental.json --reference .local/review/independent-reference-v1.json --raw-source .local/review/horizons-raw.txt --max-direction-arcsec 1 --max-distance-ppm 10 --max-epoch-seconds 0.1
```

**All tolerances are supplied by the reviewer** and are never selected automatically by the tool. The numbers above are illustrative, NOT endorsed scientific tolerances. Maximum permitted user-declared values are 3,600 arcseconds, 1,000,000 parts per million, and 1 second; the reviewer must independently justify much tighter thresholds against known scientific requirements. Do not select thresholds solely to make a failing comparison pass.

## Interpretation

- `INCOMPARABLE`: reject missing provenance, changed raw source, malformed, unrelated, or scientifically inconsistent comparison inputs.
- `OUTSIDE_DECLARED_TOLERANCE`: the aligned values disagree beyond at least one declared tolerance.
- `WITHIN_DECLARED_TOLERANCE_EXPERIMENTAL`: **only** the supplied normalized numbers agree within declared tolerances. The `scientificallyValidated` field is always `false`.

The checker computes spherical angular separations for ecliptic, equatorial and (where defined) horizontal directions (including correct 360° wrapping), plus relative distance error in ppm and TT/TDB epoch difference in seconds. It requires consistent azimuth-null semantics. It exposes only the maximum discrepancies, never individual chart positions, observer coordinates, raw source contents, or local file paths. Files are opened read-only, symlinks rejected, input JSON capped at 128 KiB each, and raw source capped at 32 MiB and SHA-256 streamed in 1 MiB blocks. There are **no network requests, writes, GUI privileges, accounts, API credentials or production changes**.

## What is still missing

- **Authentic** independent JPL Horizons reference data and a separately reviewed, physically equivalent normalization; the test fixtures are deliberately fictional.
- Pinned Rust ephemeris crate API, proven provenance and rights for a real classic DE441 file, native Rust Tauri/Cargo build and numerical reference verification across bodies/dates/edges, including leap-second/EOP handling and physical corrections.
- Independent validation of the original raw source, query settings, normalization code hashes and dataset identity. A user can fabricate consistent JSON and checksums: **a green comparator is not a trust certificate**.
- An approved tolerance budget tied to actual product requirements. No calculation output may be presented as validated, and the draft #51 quarantine remains in force.

## Tests performed

`node --test tests/compare-de441-reference.test.mjs` on Node.js 22.16.0: **19/19 passed**, with mocked numbers, wraparound, mismatched model and provenance, malformed private fields, local file safety and CLI redaction checks. Real Rust, Windows Tauri/WebView2, external Horizons queries and the full desktop `npm test` / Angular build were **not run**.

Draft-only addition stacked on #55 → #48 → #47. No GitHub Actions, publication, main merge or releases.
