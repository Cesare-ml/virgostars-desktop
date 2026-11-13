# D-19 — Offline review of a real Horizons text vector with wire version 1.2

**Status: locally tested structural-review tool. It has NOT been run on an authentic JPL vector response. It does NOT approve source, dataset, scientific accuracy or any end-user chart.**

## Rationale

The live public NASA/JPL Horizons API reports `API VERSION: 1.2` (verified 2026-11-13), while the existing D-11 production-independent downloader remains pinned to a separately reviewed sample envelope `1.0` and therefore fails closed. The new standalone **offline reviewer** allows an operator to examine the **original unmodified text bytes** of a 1.2 vector response in a trusted, private local folder without prematurely widening the accepted downloader format.

Horizons documents the vector settings [in the official API reference](https://ssd-api.jpl.nasa.gov/doc/horizons.html): `EPHEM_TYPE=VECTORS`, `REF_PLANE=FRAME`, `REF_SYSTEM=ICRF`, `CENTER='500@0'`, `VEC_TABLE=2`, `OUT_UNITS=KM-S`, `VEC_CORR=NONE`, `TIME_TYPE=TDB`, `TLIST_TYPE=JD` and quoted `TLIST`. Their combination describes an **SSB-relative geometric ICRF Cartesian state**, *not* a topocentric chart quantity.

## Operator command

On a trusted computer, first obtain an independently reviewed TDB Julian day and a real original text-format vector response. Preserve those original bytes locally, without editing or reformatting. The following command is illustrative **with fictional test values only**:

```powershell
node scripts/ephemeris/review-horizons-wire-sample.mjs --file 'D:\review\horizons-sun-original.txt' --body sun --tdb-jd 2460000.500000
```

- The only accepted body identifiers are the ten canonical names in the query-plan generator: sun, moon, mercury, venus, mars_barycenter, jupiter_barycenter, saturn_barycenter, uranus_barycenter, neptune_barycenter, pluto_barycenter.
- The file must be a **regular, non-symlinked, unchanged** local file of 1–524288 bytes with strict UTF-8. The reader uses O_NOFOLLOW where available and checks inode/size/mtime/ctime across one bounded descriptor read. This is not an atomic cross-file transaction.
- No outgoing network connection, automatic startup, backend key, file write, file deletion or chart update occurs.
- The fixed CLI output never contains the reviewed date/epoch, body coordinates, raw source response, user location, or private local filename.

## What a positive result means

`WIRE_1_2_STRUCTURE_REVIEWABLE_UNVERIFIED` means **only** that the file's *self-declared* API source/version, target ID, SSB center, BODY CENTER site, KM-S units, geometric output, position+velocity format, ICRF reference, Earth mean equator/equinox, TDB time and exactly one finite eight-column CSV row were *structurally recognizable*. It also requires the row JDTDB to match the operator's independently reviewed TDB JD.

The tool fails closed for mismatching models, duplicate/spoofed headers, unsupported versions, extra ephemeris rows, malformed data and changed or unsafe file reads. Even its positive result always returns `scientificallyValidated:false`, `sourceAuthenticated:false`, `vectorFormatApproved:false` and `comparisonReady:false`. Those flags must not be overridden by another component.

**This is not a release gate**. A self-consistent response can be fabricated. An exact-match epoch is not independent epoch validation, DE441 version identity or reference provenance. A real scientific review must establish actual JPL source, archive request/response hashes, kernel/dataset identity, time conversion, observer geometry, frame definitions and corrections. It must perform a separately reviewed numerical transformation and comparison against the Rust ephemeris. No direct comparison between SSB Cartesian vectors and geocentric/topocentric ecliptic longitudes is legitimate.

## Executed tests, precise scope

Using **Node.js v22.16.0** on an isolated mirror of the exact source modules, the following command passed **82/82** targeted tests with zero failures, skips or cancellations:

```text
node --test tests/*.test.mjs
# 82 tests, 82 pass, 0 fail, 0 skipped

node scripts/ephemeris/run-horizons-regressions.mjs --suite core
# HORIZONS_REGRESSION:PASS
# HORIZONS_TEST_COUNT:29

node scripts/ephemeris/run-horizons-regressions.mjs --suite all
# HORIZONS_REGRESSION:INCOMPLETE
```

The 16 new `tests/review-horizons-wire-sample.test.mjs` cases use **fictional**, untrusted synthetic responses and real temporary files for the read path. The previous local set was 66 passing tests. The full manual gate now explicitly expects **115/115 tests** across eight suites. The old plan-generation, full mocked acquisition and offline bundle-verification tests are not mounted in this mirror, and 115/115 has **not** been executed. Live full JPL vector acquisition was also unavailable from this execution environment.

No merge to `main`, GitHub Actions, publication, release, deployment, account data, credentials or private birth data.
