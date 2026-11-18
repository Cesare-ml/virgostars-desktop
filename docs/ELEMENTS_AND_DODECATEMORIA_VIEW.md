# Elementi e dodecatemori — vista alternativa al tema

Status: **Locally tested prototype**. 902 Node tests, synthetic Angular build/offline/CSP/privacy gates, and private-artwork build with 1,013 manifest-verified assets passed in a Linux development checkout on 2026-11-18. The private-artwork dev server starts with `npm run start:private` without rebuilding the native installer. Native Windows WebView2 visual acceptance is still pending.

## Interaction

- With a calculated chart active, the **Elementi** button in the upper right toggles the central workspace between the existing Three.js wheel and a lightweight, scrollable element distribution. The wheel remains mounted underneath; no alternative wheel renderer is introduced.
- The **left** column places traditional planets into **houses**, categorized by the natural elements of houses I/V/IX (fire), II/VI/X (earth), III/VII/XI (air), IV/VIII/XII (water).
- The **right** column places the same planets into **zodiac signs**, categorized by the conventional four triplicities. The four bands follow the supplied visual reference: fire (red), air (yellow), water (blue), earth (green). Labels and planet symbols accompany colors.
- ASC and DS appear as opposing arrow-shaped markers **inside the matching elemental bands**: ASC on the left, DS on the right. Their element derives from the zodiac sign, independently of the houses. MC/IC ornamentation in the reference is deliberately omitted for clarity.
- **Mostra dodecatemori / Show dodecatemoria** adds a second, dashed line beneath each original band, with the sign and house of each of the seven dodecatemoria. It does not replace planetary longitudes or mix the two datasets. Both IT and EN use the same arrangement and standard readable symbols.
- The house grouping (including dodecatemoria) changes with the already selected house system. The sign grouping does not. Planet chips expose the full planet name, zodiac degrees and house via a tooltip/accessible label.
- A modality summary groups the same seven longitudes by zodiac sign quality: cardinal, fixed and mutable. Its bars are proportional to the number of available traditional planets, never to an assumed seven when bodies are missing.
- A conventional lower-triangle 7×7 aspect matrix shows conjunction, sextile, square, trine and opposition using existing active-chart aspect settings and orbs. The other aspect definitions continue to be available in the main aspect inspector.
- Both axes of the aspect matrix use the **same planet artwork glyph component** as the element and modality chips; text names remain in accessible labels and hover titles. The former per-element `3 / 7` counter beneath each elemental triangle is removed. Planet/sign and planet/house chips use the elemental color as their full background with the **shaped white glyphs** from `img/simboli-bianchi/elementi-celesti/` and `img/simboli-bianchi/segni/`. Matrix headers use the same approved white source with a black CSS filter in the light theme. This corrects the earlier use of legacy `simboli/*/875x605/` files that contain flat rectangles; missing or invalid files still retain a text fallback.
- For privately authorized builds, visual symbols are loaded from the vetted `astrological-assets` manifest. Missing PNGs and legacy opaque rectangular placeholders produce a monochrome glyph fallback, rather than blank boxes. The default synthetic developer mode intentionally keeps using synthetic test assets; the built-in wheel reads from the same `/assets/` root selected by the build.

## Data and boundaries

- **Exactly the seven traditional planets:** Sun, Moon, Mercury, Venus, Mars, Jupiter and Saturn. The provider may supply fewer; do not invent missing bodies.
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
6. Start `npm run start:private` from an authorized checkout with `../astrological-assets`; check the network panel for local `/assets/img/` image responses and validate that the wheel and Elementi use the approved paths. Run `npm run tauri:dev` in a separate terminal after the Angular server is ready.

Out of scope: additional modern planets, transits/synastry overlay distribution, separate dodecatemoria house system, printing/PNG of this panel, changing the source calculation method, and modifying other repositories.
