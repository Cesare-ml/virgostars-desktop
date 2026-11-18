# Elementi e dodecatemori — vista alternativa al tema

Status: **Locally tested prototype**. A synthetic and approved private-artwork build and their offline/privacy gates are exercised in development; Windows WebView2 visual acceptance is still pending. `npm start` stages 1,013 verified original images from the sibling asset checkout for local testing without rebuilding the native installer; the synthetic dev fallback is explicitly `npm run start:synthetic`.

## Interaction

- With a calculated chart active, separate **Elementi** and **Aspetti** buttons in the upper right toggle the central workspace between the existing Three.js wheel, a scrollable element distribution, and a dedicated aspect matrix. The wheel stays mounted underneath; no alternative wheel renderer is introduced.
- The **left** column places traditional planets into **houses**, categorized by the natural elements of houses I/V/IX (fire), II/VI/X (earth), III/VII/XI (air), IV/VIII/XII (water).
- The **right** column places the same planets into **zodiac signs**, categorized by the conventional four triplicities. The four bands follow the supplied visual reference: fire (red), air (yellow), water (blue), earth (green). Labels and planet symbols accompany colors.
- ASC and DS appear as opposing arrow-shaped markers **inside the matching elemental bands**: ASC on the left, DS on the right. Their element derives from the zodiac sign, independently of the houses. MC/IC ornamentation in the reference is deliberately omitted for clarity.
- **Mostra dodecatemori / Show dodecatemoria** adds a second, dashed line beneath each original band, with the sign and house of each of the seven dodecatemoria. It does not replace planetary longitudes or mix the two datasets. Both IT and EN use the same arrangement and standard readable symbols.
- **Mostra transaturnini / Show outer planets**, beside the dodecatemoria control, optionally adds Uranus, Neptune and Pluto to house/sign element rows and cardinal/fixed/mutable counts. Missing computed bodies stay absent. The seven traditional dodecatemoria are unchanged because the current adapter supplies no outer-planet dodecatemoria.
- The house grouping (including dodecatemoria) changes with the already selected house system. The sign grouping does not. Planet chips expose the full planet name, zodiac degrees and house via a tooltip/accessible label.
- A modality summary groups the active distribution's available longitudes by zodiac sign quality: cardinal, fixed and mutable. Its bars use the actual number of available planets (up to ten with the toggle), not a fixed denominator.
- The separate **Aspetti** presentation shows a conventional lower-triangle **10×10** matrix for conjunction, sextile, square, trine and opposition. It always evaluates the available ten planets, including the three transaturnini, even though the main wheel intentionally disables outer-planet aspect lines by default. It retains the user's configured orbs and active aspect types; it does not change the main wheel or inspector settings. The other aspect definitions continue to be available in the main aspect inspector.
- Both axes of the aspect matrix use the **same planet artwork glyph component** as the element and modality chips; text names remain in accessible labels and hover titles. The former per-element `3 / 7` counter beneath each elemental triangle is removed. Planet/sign and planet/house chips use the elemental color as their full background with the **shaped white glyphs** from `img/simboli-bianchi/elementi-celesti/` and `img/simboli-bianchi/segni/`. Matrix headers use the same approved white source with a black CSS filter in the light theme. This corrects the earlier use of legacy `simboli/*/875x605/` files that contain flat rectangles; missing or invalid files still retain a text fallback.
- For privately authorized builds, visual symbols are loaded from the vetted `astrological-assets` manifest. Missing PNGs and legacy opaque rectangular placeholders produce a monochrome glyph fallback, rather than blank boxes. The `npm start` local dev mode now loads real artwork by default; contributors without artwork should use `npm run start:synthetic`. The built-in wheel reads from the same `/assets/` root selected by the build.

## Data and boundaries

- **Seven traditional planets by default** in Elementi, with Uranus/Neptune/Pluto available via an explicit toggle; the Aspetti matrix always includes these ten when present. The provider may supply fewer; do not invent missing bodies.
- Use the active calculated radix/sky snapshot (`TemaRenderData`), **not** the transit/synastry overlay. The new view is a presentation, not an independent chart calculation.
- The existing `buildTemaRenderData` adapter already calls `dodecatemoriaLongitude()` from `astrological-functions` for these seven bodies. Its chosen convention is `longitude + 12 × (longitude within the sign)` modulo 360, equivalent to `sign start + 13 × within-sign longitude`. Therefore a planet at 10° Aries has dodecatemorion 10° Leo. A hypothetical or invented position must never be substituted for a missing result. Other historical conventions must be introduced through a separate versioned method option, not silently here.
- Derive houses (also for dodecatemoria) using `locateLongitudeInHouses` from `astrological-functions` and the selected calculated cusp array; if unavailable or invalid, leave the left grouping empty instead of guessing.
- This is a synchronous local read-only presentation with no new Tauri IPC, backend, cloud calls, telemetry, storage of birth data, permissions or asset licenses. No astronomical or astrological algorithm is duplicated in the Desktop app.
- Existing **Esporta PNG** exports the *wheel*; the button is hidden while Elementi is selected, until an explicit export of this alternative view is designed.

## Acceptance checks

1. With a synthetic seven-body fixture, all seven appear once on each base side and once on each dodecatemorion side; Uranus is not included.
2. Change the house system: only the left side changes. For ASC in Leo, DS is Aquarius; the element badges read Fire and Air, irrespective of houses.
3. Show/hide dodecatemoria without altering the original positions; switch back to the existing wheel; change the theme or language; navigate to a new time without keeping obsolete positions.
4. Verify keyboard, scroll and readable planet chips at narrow window widths, Windows WebView2 high-contrast and light/dark themes. Confirm the chart-first controls remain operational and WebGL/CSS layout diagnosis does not report a false hidden canvas.
5. Run the Desktop unit suite, translation/Angular production gates, and a real native Windows GUI smoke before marking this **Integrated**.
6. Start `npm start` from an authorized checkout with `../astrological-assets`; check the network panel for local `/assets/img/` image responses and validate that the wheel and Elementi use the approved paths. Run `npm run tauri:dev` in a separate terminal after the Angular server is ready. A different Angular server still bound to port 4200 must be stopped first.

Out of scope: planets beyond Pluto, transits/synastry overlay distribution, separate dodecatemoria house system, printing/PNG of these panels, changing the source calculation method, and modifying other repositories.
