# Elementi e dodecatemori — vista alternativa al tema

Status: **Locally tested prototype**. 900 Node tests and the synthetic Angular build/offline/CSP/privacy gates passed in a Linux development checkout on 2026-11-17; native Windows WebView2 visual acceptance remains pending before integration/release. A local Chromium screenshot attempt was blocked by the environment's socket permission policy, so no image is claimed as inspected.

## Interaction

- With a calculated chart active, the **Elementi** button in the upper right toggles the central workspace between the existing Three.js wheel and a lightweight, scrollable element distribution. The wheel remains mounted underneath; no alternative wheel renderer is introduced.
- The **left** column places traditional planets into **houses**, categorized by the natural elements of houses I/V/IX (fire), II/VI/X (earth), III/VII/XI (air), IV/VIII/XII (water).
- The **right** column places the same planets into **zodiac signs**, categorized by the conventional four triplicities. The four bands follow the supplied visual reference: fire (red), air (yellow), water (blue), earth (green). Labels and planet symbols accompany colors.
- A simple ASC and DS pair at the top shows the zodiac sign and element of each angle. These are sign attributes, not the element of the houses. MC/IC ornamentation in the reference is deliberately omitted for clarity.
- **Mostra dodecatemori / Show dodecatemoria** adds a second, dashed line beneath each original band, with the sign and house of each of the seven dodecatemoria. It does not replace planetary longitudes or mix the two datasets. Both IT and EN use the same arrangement and standard readable symbols.
- The house grouping (including dodecatemoria) changes with the already selected house system. The sign grouping does not. Planet chips expose the full planet name, zodiac degrees and house via a tooltip/accessible label.

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

Out of scope: additional modern planets, transits/synastry overlay distribution, separate dodecatemoria house system, printing/PNG of this panel, changing the source calculation method, and modifying other repositories.
