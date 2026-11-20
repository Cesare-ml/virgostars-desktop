# Cielo 3D · observer sky · MVP 1 (2026-11-20)

**Status:** first implementation in a feature branch; not yet smoke-tested on Windows/WebView2 and **not scientifically certified**. This document describes what the branch contains, not a released or merged feature.

## Product concept

An offline-first interactive celestial dome for the observer at the active chart's location and instant. It complements, but does not replace, the existing astrological wheel. Initial controls: horizon, meridian, geographic N/E/S/W orientation, celestial equator, **true tropical ecliptic and twelve separate 30° zodiac arcs**, optional horizontal grid, terrain occlusion, stars, real apparent planet positions, selection to inspect geometric altitude/azimuth, mouse panning and zoom.

**One astronomical source:** The versioned, read-only Tauri command `calculate_sky_dome` calls the existing VirgoStars-Ephemeris provider via `chart_calculation::respond`, including its validated fixed-star catalogue response. There is no browser calculation of ephemerides, remote sky API, fabricated star field, or automatic fallback to a different engine. Three.js only plots already computed horizontal coordinates on the celestial sphere.

## Observer-frame coordinates

- Host-provided apparent equatorial right ascension/declination in the true equator of date and ARMC from the same chart calculation; latitude/longitude from validated chart request.
- Rust computes a WGS84 geocentric observer vector at **sea level**, subtracts it from the body vector in the local hour-angle frame and obtains East/North/Up components. Geometric topocentric altitude and azimuth (0=N, 90=E, 180=S, 270=W) follow. No atmospheric refraction, horizon elevation or terrain profile.
- The interface treats bodies as **symbolic markers**, not apparent disks at their actual angular sizes. Geocentric positions, distance and ARMC remain dependent on the canonical provider and its coverage/validation limits.
- Planet positions include Earth-rotation parallax; the Moon must **not** be drawn at geocentric altitude. Unit tests check the lunar-horizon correction. Broader comparisons with Stellarium and independent references are a release gate.
- Fixed-star horizontal positions come from the existing fixed-star provider, converted from its South/West azimuth convention. The local catalogue can be incomplete or approximate; the UI marks approximate stars, and a single Sirius fallback is **not** presented as an entire star catalogue.
- The command currently requires a house-system result to obtain ARMC; polar/unsupported configurations fail closed. A future ephemeris-level sidereal primitive will decouple the celestial frame from house availability.
- This first contract follows the *modern chart* UTC input restrictions (1900–2033, with stricter actual ΔT/data availability). Historic charts are **not** silently mapped to a modern instant.

## Zodiac/ecliptic implementation

The Rust `calculate_sky_dome` response also supplies `zodiacSegments`: **exactly 12 ordered segments, each with 31 computed direction points and one midpoint**. These are longitude intervals [0°,30°], [30°,60°], etc. in the *true ecliptic/equinox of date*. The host uses `houseAngleContext.trueObliquityDeg` and `ARMC` from the same calculated chart, rotates the ecliptic-of-date unit vector into the true equatorial frame, then computes local geometric altitude and north-through-east azimuth for each ecliptic direction. The markers are points at infinite astronomical distance, unlike topocentric physical bodies.

Angular wrap at 360° is handled as an actual spherical vector: the azimuth becomes mathematically indeterminate at the zenith/nadir, so numerical QA compares unit vectors rather than azimuth equality at those singularities. This layer is not a precessional/sidereal zodiac switch; no sidereal offset is silently applied.

The WebView validates the received 12×31 points and draws the arcs, 30° boundaries and sign images from `/assets/img/simboli-bianchi/segni/` using the approved `zodiacGlyphUrl` helper. The **Eclittica** and **Segni** toggles can be switched independently. No emoji glyphs or local JS astronomy are used; missing glyph assets are omitted. All textures, geometries and stale-request artefacts are cleaned up when the layer changes or the component unmounts.

This new zodiac geometry is implemented **but not yet compiled or native-smoke-tested**. It remains in the draft PR pending WebView2 rendering and independent astronomical comparison.

## Real chart axes on the celestial sphere

The native response additionally supplies `angles` in strict `ASC, DSC, MC, IC` order. The inputs are the ephemeris/chart provider's **Ascendant longitude, Midheaven longitude**, and their 180° opposites, all interpreted as *ecliptic directions*, not separate physical planets. They are projected through the same true obliquity, sidereal angle and observer location as the zodiac. This shows the intersection of the ecliptic with the local horizon and meridian, allowing a direct comparison with the 2D astrological wheel.

The overlay is controlled by **Angoli** and uses a distinct palette: ASC yellow, DSC green, MC violet and IC light violet. Each label is positioned at the computed point; no house boundary circles are inferred from these four points. Numerical QA and native screenshots with multiple house systems are still required; the code remains draft.

## Rendering and performance

- `SkyDomeComponent` is created only when the user opens Cielo 3D, and destroyed when they leave. Camera starts looking South/24° up; users can drag, scroll to zoom, select a planet/star, or use cardinal buttons.
- One WebGL canvas, dynamic planet meshes and magnitude-binned star points. No frame loop except redraws on interaction, resize, layer changes, or fresh astronomical input. Pixel ratio capped at 2.
- Geometry/material/renderer and native event listeners are released on component destruction. Stale asynchronous results cannot replace the scene of a newer instant. WebGL failure is reported.
- Tauri command remains read-only, no account access, no data paths from the WebView, and no background/network jobs.

## Planned didactic layers (not implemented)

The rendering boundary already defines `SkyOverlayPolyline` with `kind`, `provenance` and validated horizontal points. The first native-calculated zodiac arcs are now implemented. **House boundaries and true primary directions are not implemented.** Planned additions:

1. **Zodiac/ecliptic extensions:** visualize zodiacal latitude/offsets, selectable tropical-versus-explicitly-converted other frameworks if ever requested, sign-boundary hover/details, rising/setting intersections and frame metadata. The first tropical 12-segment arc and approved glyphs are now implemented.
2. **Houses in the sky:** project each house system's **actual geometrical boundaries** in the celestial frame, *not* evenly spaced azimuth sectors and not merely 12 ecliptic cusp points. Name the domification and explicitly mark systems undefined at polar latitudes. Validate Regiomontanus/Campanus/Placidus independently.
3. **True primary directions:** separate from existing `SIMPLIFIED_PRIMARY` or symbolic solar-arc directions. Define the historical doctrine and computational method first: promissor/significator, semi-arc, pole of the significator, right/oblique ascension, direct/converse, arc/time key, zodiacal versus mundane directions, under/above horizon, latitude, precession and calendar/time scales. Produce an explicit mathematical arc and a progression on the *natal* celestial frame; never treat the progressed longitude as a physically observed planet or confuse primary directions with transits. Show 3D geometrical constructions and an audit table for every result. Cross-validate with reference examples before enabling.
4. Future common infrastructure belongs in **VirgoStars-Ephemeris (Rust)** for astronomy and **astrological-functions** for house/doctrinal algorithms; Three.js remains a renderer.

## Visual design update — planetarium HUD (2026-11-20)

**Implemented in the draft branch (not yet visually tested on Windows):**

- An immersive full-bleed, dark-blue star field with subtle atmospheric gradients. The CSS appearance changes between `night`, `twilight` and `day` based **only** on the Sun's computed geometric altitude. The gradient is explicitly *illustrative*, not an atmospheric/refraction/visibility simulation. No decorative/fake stars were added.
- Catalogue-derived star markers rendered with an original radial luminosity texture. Magnitude changes size and opacity in four capped classes; unknown magnitudes receive faint markers. The visual tint is aesthetic and **does not claim B–V/spectral classifications**.
- Physical Sun, Moon and planets use native-computed sky positions with small luminous halos. Original VirgoStars-Assets celestial glyphs are loaded for each planet, with the mathematical marker retained if an asset is missing. Sizes are symbolic; no false angular-diameter claim is made.
- The official zodiac glyph assets decorate the actual tropical 30° ecliptic segments. ASC/DSC/MC/IC retain their existing yellow, green and two violet conventions. The ground, when active, occludes objects below the horizon, including zodiac artwork.
- The front end has a structured, responsive glass-style **Cielo 3D** control panel, a compact epoch/location display, camera azimuth/altitude and field-of-view readouts, selectable planet/star detail cards, and a bottom dock of planet glyphs for direct orientation to each **computed** body.
- The camera supports drag, wheel zoom, keyboard arrows, Shift+arrows for larger movements, `+`/`-` for field-of-view, `Home` to reset and direct N/E/S/O/zenith controls. Only necessary state changes schedule a frame; there is no continuous animation loop.
- Star, sign, planet and selection textures are private, generated locally or loaded from the approved asset path; no third-party images/fonts or network feeds were added. Texture, renderer, and event listener cleanup is required when the panel closes.

**Visual QA acceptance checklist (still open):**

1. Test native WebView2 at normal and 125%/150% DPI; verify the planet dock and control panel never cover important content at typical Desktop window sizes.
2. Check every Sun altitude mode with the same astronomical data; ensure night/twilight/day changes only the background, not celestial positions. Document that daytime star visibility is didactic.
3. Verify glyph loads from approved private/synthetic asset builds, and every broken/missing artwork path fails gracefully (no broken-image icons/emoji substitutes).
4. Check marker pick, focus-to-planet, selection ring, highlighting, click-vs-drag and camera reset, including the Sun, Moon, low-altitude and below-horizon targets.
5. Test renderer disposal, asset reloads, resize and WebGL context-loss; profile 738 local stars and less powerful GPUs, keeping one canvas and no unnecessary animation.
6. Preserve keyboard accessibility and sufficient contrast, including when the panel is shown over the bright illustrative daytime gradient.

**No pixel-perfect screenshot approval or compiled GUI smoke test has been performed in this session.**

## Next acceptance gates

- Run `npm test`, `npm run verify:ipc`, `npm run build:ui` on the complete checkout; run `cargo test` and `cargo check` for relevant Desktop features. No CI or GitHub Actions are triggered by this branch.
- Launch native Windows build with configured DE441; compare Sun, Moon, Mercury, stars, **ecliptic arc, sign boundaries and the ASC/DSC/MC/IC intersections** for multiple latitudes/longitudes, horizon rise/set, near poles, southern hemisphere, longitude wrapping, year boundaries, day/night and changing local sidereal time. Record reference conventions and residuals.
- Test WebView2 context-loss and low-power GPU, 738-star local catalogue, missing/approximate catalogue, browser-only preview, navigation of live-sky versus natal chart, and clean canvas teardown.
- Extend a fully validated spherical-coordinate API in VirgoStars-Ephemeris, including configurable observer elevation and refraction (optional) before broad release.
- Verify licences/provenance for bundled star catalogues, artwork, landscape and any third-party sky assets. Stellarium graphics/code are **not** copied.
