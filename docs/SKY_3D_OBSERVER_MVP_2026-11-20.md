# Cielo 3D · observer sky · MVP 1 (2026-11-20)

**Status:** first implementation in a feature branch; not yet smoke-tested on Windows/WebView2 and **not scientifically certified**. This document describes what the branch contains, not a released or merged feature.

## Product concept

An offline-first interactive celestial dome for the observer at the active chart's location and instant. It complements, but does not replace, the existing astrological wheel. Initial controls: horizon, meridian, geographic N/E/S/W orientation, celestial equator, optional horizontal grid, terrain occlusion, stars, real apparent planet positions, selection to inspect geometric altitude/azimuth, mouse panning and zoom.

**One astronomical source:** The versioned, read-only Tauri command `calculate_sky_dome` calls the existing VirgoStars-Ephemeris provider via `chart_calculation::respond`, including its validated fixed-star catalogue response. There is no browser calculation of ephemerides, remote sky API, fabricated star field, or automatic fallback to a different engine. Three.js only plots already computed horizontal coordinates on the celestial sphere.

## Observer-frame coordinates

- Host-provided apparent equatorial right ascension/declination in the true equator of date and ARMC from the same chart calculation; latitude/longitude from validated chart request.
- Rust computes a WGS84 geocentric observer vector at **sea level**, subtracts it from the body vector in the local hour-angle frame and obtains East/North/Up components. Geometric topocentric altitude and azimuth (0=N, 90=E, 180=S, 270=W) follow. No atmospheric refraction, horizon elevation or terrain profile.
- The interface treats bodies as **symbolic markers**, not apparent disks at their actual angular sizes. Geocentric positions, distance and ARMC remain dependent on the canonical provider and its coverage/validation limits.
- Planet positions include Earth-rotation parallax; the Moon must **not** be drawn at geocentric altitude. Unit tests check the lunar-horizon correction. Broader comparisons with Stellarium and independent references are a release gate.
- Fixed-star horizontal positions come from the existing fixed-star provider, converted from its South/West azimuth convention. The local catalogue can be incomplete or approximate; the UI marks approximate stars, and a single Sirius fallback is **not** presented as an entire star catalogue.
- The command currently requires a house-system result to obtain ARMC; polar/unsupported configurations fail closed. A future ephemeris-level sidereal primitive will decouple the celestial frame from house availability.
- This first contract follows the *modern chart* UTC input restrictions (1900–2033, with stricter actual ΔT/data availability). Historic charts are **not** silently mapped to a modern instant.

## Rendering and performance

- `SkyDomeComponent` is created only when the user opens Cielo 3D, and destroyed when they leave. Camera starts looking South/24° up; users can drag, scroll to zoom, select a planet/star, or use cardinal buttons.
- One WebGL canvas, dynamic planet meshes and magnitude-binned star points. No frame loop except redraws on interaction, resize, layer changes, or fresh astronomical input. Pixel ratio capped at 2.
- Geometry/material/renderer and native event listeners are released on component destruction. Stale asynchronous results cannot replace the scene of a newer instant. WebGL failure is reported.
- Tauri command remains read-only, no account access, no data paths from the WebView, and no background/network jobs.

## Planned didactic layers (not implemented)

The rendering boundary already defines `SkyOverlayPolyline` with `kind`, `provenance` and validated horizontal points. In this version *no* zodiac, house or true-primary-direction polyline is generated. The intent:

1. **Zodiac/ecliptic:** ecliptic great circle/obliquity plus 12 accurately calculated 30° intervals, ecliptic-of-date frame and precisely defined Aries origin, with sign glyphs exclusively from the approved VirgoStars assets. Optional zodiac latitude visualizations.
2. **Houses in the sky:** project each house system's **actual geometrical boundaries** in the celestial frame, *not* evenly spaced azimuth sectors and not merely 12 ecliptic cusp points. Name the domification and explicitly mark systems undefined at polar latitudes. Validate Regiomontanus/Campanus/Placidus independently.
3. **True primary directions:** separate from existing `SIMPLIFIED_PRIMARY` or symbolic solar-arc directions. Define the historical doctrine and computational method first: promissor/significator, semi-arc, pole of the significator, right/oblique ascension, direct/converse, arc/time key, zodiacal versus mundane directions, under/above horizon, latitude, precession and calendar/time scales. Produce an explicit mathematical arc and a progression on the *natal* celestial frame; never treat the progressed longitude as a physically observed planet or confuse primary directions with transits. Show 3D geometrical constructions and an audit table for every result. Cross-validate with reference examples before enabling.
4. Future common infrastructure belongs in **VirgoStars-Ephemeris (Rust)** for astronomy and **astrological-functions** for house/doctrinal algorithms; Three.js remains a renderer.

## Next acceptance gates

- Run `npm test`, `npm run verify:ipc`, `npm run build:ui` on the complete checkout; run `cargo test` and `cargo check` for relevant Desktop features. No CI or GitHub Actions are triggered by this branch.
- Launch native Windows build with configured DE441; compare Sun, Moon, Mercury and stars for multiple latitudes/longitudes, horizon rise/set, near poles, southern hemisphere, longitude wrapping, year boundaries, day/night and changing local sidereal time. Record reference conventions and residuals.
- Test WebView2 context-loss and low-power GPU, 738-star local catalogue, missing/approximate catalogue, browser-only preview, navigation of live-sky versus natal chart, and clean canvas teardown.
- Extend a fully validated spherical-coordinate API in VirgoStars-Ephemeris, including configurable observer elevation and refraction (optional) before broad release.
- Verify licences/provenance for bundled star catalogues, artwork, landscape and any third-party sky assets. Stellarium graphics/code are **not** copied.
