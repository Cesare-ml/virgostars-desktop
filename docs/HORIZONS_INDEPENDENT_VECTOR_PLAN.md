# Independent JPL Horizons geometric-vector request plan

**Status:** locally tested operator-side request planner. No Horizons API call, retrieved astronomical response, scientific parity, native integration or chart-ready calculation has been executed.

## Purpose

The experimental VirgoStars-Ephemeris Rust `first_sky` output has ten named bodies but remains geometric, partly approximate, and not independently validated. The desktop's current D-04 / D-09 comparison tools rely on independently normalized reference files. This planner is a concrete way to prepare **reproducible, explicit NASA/JPL Horizons requests** for the *upstream inertial Cartesian input data* without silently assuming the result is directly comparable to the desktop's topocentric mean-of-date values.

Official API specification: [JPL Horizons API, version 1.3 (June 2025)](https://ssd-api.jpl.nasa.gov/doc/horizons.html). The parameter choices below must be reviewed against that official documentation before real use.

## Operator workflow

First obtain and independently review a **TDB Julian day** for a non-private validation epoch. Do **not** use local civil time, a UTC string or the Rust engine's own TDB approximation as if it were independently verified. The script does not convert calendar dates or compute astronomical quantities.

Run from a complete repository checkout using Node.js 22+ (illustrative synthetic epoch only):

```powershell
node scripts/ephemeris/prepare-horizons-vector-plan.mjs --tdb-jd 2460000.500000 --out 'D:\review\horizons-vector-plan.json'
```

The output is a locally saved JSON plan with **ten distinct request URLs**; the CLI only prints fixed status codes. The target file must not exist beforehand and is created with exclusive permissions where the operating system supports them; the script never overwrites another file. The containing folder must exist. Keep query plans and actual Horizons raw responses outside public repositories because timestamps and future site details could identify a private birth record.

Review the plan and each URL, then **manually retrieve** original response bytes from NASA/JPL. Save them without reformatting, retaining exact request/query bytes and independently verified provenance. This script does not contact NASA/JPL, download responses or claim that a successful HTTP reply is authentic astronomy.

## Exact independent query geometry

Every request explicitly selects:

| Horizons setting | Required value | Reason |
| --- | --- | --- |
| `EPHEM_TYPE` | `VECTORS` | Raw state vectors, not observer/apparent angular quantities |
| `CENTER` | `'500@0'` | Solar-system barycenter; **not** a geodetic topocentric observer |
| `REF_PLANE` | `FRAME` | ICRF frame rather than default J2000 ecliptic plane |
| `REF_SYSTEM` | `ICRF` | Inertial celestial reference frame |
| `VEC_CORR` | `NONE` | Geometric states; no light-time/aberration correction |
| `OUT_UNITS` | `KM-S` | Kilometres and kilometres per second |
| `VEC_TABLE` | `2` | Position and velocity Cartesian vector components |
| `TIME_TYPE` | `TDB` | Dynamical timescale for vector ephemerides |
| `TLIST_TYPE` | `JD` | Explicit Julian-day interpretation |
| `TLIST` | Independently reviewed TDB JD | One exact requested epoch, without default span behavior |
| `CSV_FORMAT` / `VEC_LABELS` | `YES` / `NO` | Easier review of each numeric state-vector record |
| `MAKE_EPHEM` / `OBJ_DATA` | `YES` / `NO` | Produce ephemeris, without verbose object summary |

The query uses **ten specific NAIF target IDs**, consistent with the current `ExperimentalSkySnapshotV1` names: Sun `10`, Moon `301`, Mercury `199`, Venus `299`, then **system barycenters** Mars `4`, Jupiter `5`, Saturn `6`, Uranus `7`, Neptune `8`, Pluto `9`. The generator never substitutes Mars/Jupiter/etc physical centers (`499`, `599`, …) for the required barycenters.

## Non-comparability until independent reduction

This is an important scientific distinction: **ICRF barycentric Cartesian state vectors are not the same quantity as mean-ecliptic/equatorial-of-date topocentric longitudes, latitudes, altitudes and azimuths.** Even if they share a DE441 source, direct angular subtraction would be scientifically invalid.

A genuinely independent and reviewed normalizer must establish the following, as applicable: reference ephemeris/dataset version, Earth barycenter and Earth's center, Moon/Earth mass ratio, observer Earth-fixed position and geodetic datum, site elevation and Earth orientation, time scales (UTC, UT1, TT, TDB), precession conventions, full geometric vs apparent/light-time corrections, ecliptic and equatorial frame definitions and distances. Independently compare resulting reference quantities against the actual Rust results using D-04/D-09. If a correction or time-scale convention cannot be reconciled, mark the comparison **incomparable** rather than guessing or widening tolerances.

The JPL Horizons service could choose different underlying ephemerides from classic DE441. An independently documented dataset identity is mandatory before claiming DE441-to-DE441 parity. A matching timestamp and vector request alone do not establish kernel identity or source authenticity.

## Verification actually completed

```powershell
node --check scripts/ephemeris/prepare-horizons-vector-plan.mjs
node --test tests/prepare-horizons-vector-plan.test.mjs
```

**Node.js v22.16.0: 10/10 tests passed** using only synthetic local test times and output files. The tests cover ten-body NAIF IDs, all explicit query settings, strict TDB JD bounds, rejection of unexpected/duplicate CLI arguments, no silent overwrite, and sanitized terminal output. They do not make live Horizons requests or evaluate actual celestial positions.

**Not executed:** real Horizons API response or NAIF binary, independent numeric vector reduction, genuine classic DE441 access, Rust/Cargo, complete Desktop npm/Angular tests, Windows Tauri/WebView2, source licensing audit, releases or production changes. No GitHub Actions or main merge.

## Numeric TLIST canonical quoting (API-format follow-up)

Per the official [Horizons API guide](https://ssd-api.jpl.nasa.gov/doc/horizons.html), single numeric `TLIST` values are individually single-quoted before URL encoding. The generator now uses `TLIST=%27<reviewed-JD>%27`, while preserving `TIME_TYPE=TDB` and `TLIST_TYPE=JD`. Regenerate previously saved query plans: unquoted `TLIST` plans are intentionally no longer canonical. Run the offline bundle verifier after acquisition; see [HORIZONS_OFFLINE_BUNDLE_AUDIT.md](HORIZONS_OFFLINE_BUNDLE_AUDIT.md).
