# D-02a — Experimental geometric sky response contract v1

**Status: locally tested TypeScript validation only. Not a native Rust ephemeris integration, not an accuracy certificate, not rendered in the UI.**

The independent VirgoStars-Ephemeris Rust crate already has an experimental first_sky::calculate(&mut De441, CivilTimestamp, Observer) function on dev/ephemeris. The current VirgoStars Desktop Tauri command desktop_calculation_probe deliberately returns unavailable / EPHEMERIS_NOT_INTEGRATED. This change prepares its receive-side type boundary, but does not change that native command or enable real astronomical positions.

## Strict received response shape

src/app/native/experimental-sky-contract.ts accepts only schemaVersion=1, scientificStatus=experimental_unverified, provider VirgoStars-Ephemeris, source format DE441_classic_binary, a 64-character lowercase SHA-256 string for the specific external kernel, exact request UTC/latitude/longitude in integer microdegrees, WGS84 height in meters, mean ecliptic and equatorial of date, and topocentric_geometric geometry.

It requires explicit TT/TDB Julian dates, integer TAI−UTC seconds in the current range 10–37, and all nine published model limitations (UT1 approximated as UTC, truncated TDB−TT, no nutation, no light-time, no aberration, no gravitational deflection, no polar motion, no refraction, and outer-planet system barycenters). It also refuses UTC instants outside the upstream IERS Bulletin C 72 window **1972-01-01 inclusive through 2027-06-28 exclusive**. No fake leap-second or unsupported time-scale fallback is allowed.

Ten distinct bodies must be present: Sun, Moon, Mercury, Venus (body centers) and Mars through Pluto (system barycenters). Each has finite, bounded mean ecliptic longitude/latitude, right ascension/declination, altitude/azimuth and strictly positive topocentric distance in kilometers. Azimuth may be null at zenith or nadir. All angles are **degrees**; labels cannot claim apparent positions or genuine Mars–Pluto body centers. A partial set, duplicate body, malformed field, extra internal path/secret, invalid kernel fingerprint string, or even a correctly correlated outer IPC envelope containing a different UTC or location is rejected.

**Shape validation is not scientific validation.** It checks that a payload honestly declares an *unverified experimental geometric model*; it cannot determine whether the claimed DE441 SHA-256 actually matches a file, whether time conversions or coordinates are numerically correct, or whether the kernel is licensed for redistribution. A mock fixture with a syntactically valid fake hash is suitable for contract tests only. Real production readiness requires independently verified kernel provenance and JPL/NAIF numerical reference comparisons. Never use a shape-valid experimental payload to render a chart labeled as accurate or apparent.

## Integration boundary

guardExperimentalSkyPort(port) is a small wrapper for a future native ready response. It leaves explicit unavailable results untouched; an unexpected ready with any invalid or mismatching snapshot becomes a **sanitized** invalid_snapshot reply with only the original session/sequence/calculation key. The D-01 queue then interprets that as invalid_reply without exposing the raw values. The opt-in nativeCalculationProbePort now installs this guard, but still is **not called by the synthetic Angular chart**.

Before connecting a native provider, map Rust fields explicitly:

| Rust experimental source | Desktop v1 |
| --- | --- |
| SkyPositions.tt_julian_day, .tdb_julian_day | ttJulianDay, tdbJulianDay |
| SkyPositions.tai_minus_utc_seconds | taiMinusUtcSeconds |
| Observer.{latitude_deg,longitude_deg_east,height_m} | verified original latMicro, lngMicro, heightMeters |
| Body::Sun through Body::Venus | bodyId, centerKind=body_center |
| Body::MarsBarycenter through PlutoBarycenter | explicit *_barycenter, centerKind=system_barycenter |
| PlanetPosition.{mean_ecliptic_longitude_deg,mean_ecliptic_latitude_deg,mean_right_ascension_deg,mean_declination_deg,altitude_deg,azimuth_deg,distance_km} | degree fields and distanceKm |
| MODEL_APPROXIMATIONS | complete mandatory approximations list |

The native adapter must supply independently verified kernel provenance (and must never echo its file path). Keep CPU work off the Tauri main thread and preserve a finite worker queue. Native cooperative cancellation remains future work; AbortSignal alone is not sufficient. Authentication and network calls are not prerequisites for guest calculations.

## Actual tests and limitations

**Executed in isolated local source mirror** with Node 22.16.0:

~~~sh
node --experimental-strip-types --test tests/experimental-sky-contract.test.mjs
# 14 passed, 0 failed
tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/native/experimental-sky-contract.ts
# passed, with a type-compatible stub for the imported queue request/port types
~~~

The exact Git blobs of the new TypeScript module and Node tests match those committed to GitHub. These tests use synthetic numeric fixtures to verify fail-closed behavior, **not JPL accuracy**. Existing Rust unit tests remain unexecuted here because Cargo/rustc are unavailable. Full npm test, Angular build, Windows Tauri/WebView2 IPC and external scientific numerical comparisons remain open.

## Next implementation gate

1. Pin/review the VirgoStars-Ephemeris Rust crate API and CPAL-1.0 attribution/redistribution obligations, then decide how to load a legally obtained DE441 classic binary without exposing arbitrary paths to the WebView.
2. Implement the bounded Rust provider and explicitly map the ten bodies, limitations, UTC/TT/TDB, accuracy status and independently verified kernel SHA-256 into the versioned reply; add cross-language golden vectors.
3. Return unavailable when the file, IERS window, supported series or verification is absent. Never silently fall back to synthetic or lower-precision positions.
4. Independently validate actual numerical results and complete Windows native IPC tests before integrating outputs with astrological-functions and astrological-charts.

No merge, GitHub Actions, production backend change, deployment, installer, licensing decision or public release occurs in this slice.
