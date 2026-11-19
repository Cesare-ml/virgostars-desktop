# Solar and lunar returns

**Status: Prototype / locally tested (2026-11-15).** Works only when the host finds the local DE441 data for the [VirgoStars-Ephemeris provider](VIRGOSTARS_EPHEMERIS_PROVIDER.md). Not released.

## What it does

- **Rivoluzione Solare:** the instants of one UTC calendar year at which the Sun is back at the radix Sun's ecliptic longitude.
- **Rivoluzione Lunare:** the same for the Moon; a year holds 13 or 14 returns.
- For any listed instant, **Erigi tema** casts a chart at the chosen place. The place defaults to the radix place and can be changed with the offline city picker or by typing coordinates (relocation).
- Solar return searches the next return at or after the current instant, including the following UTC year when needed, and displays its chart at the radix place. The separate map button opens the full-window Leaflet map, initially centred on that place. The radix and return houses, planets and axis-highlighted signs update on pointer movement. Selecting a point looks up its name and casts the chart; if lookup fails, the name can be entered manually or selected from the local city picker. The map uses OpenStreetMap and needs Internet: its servers see the IP and viewed area, and a click sends coordinates for reverse lookup. Rapid lookups are limited and cached. Time zones are approximate 2019 tz-lookup boundaries and should be checked. The previous offline map is no longer shown.
- **Sinastria con Radix** (on by default) shows the cast return with the radix chart around it.

A local Windows/WebView2 smoke test selected map points, observed the suggested
zones `America/New_York` and `Europe/Istanbul`, searched a solar return and
displayed its ASC, MC and cusp preview. This is not exhaustive geographic or
numerical validation of the approximate timezone boundaries.

The return chart is an ordinary session chart named `RS <year> <radix name>` or `RL <UTC date> <radix name>`; it can be saved to the [archive](CHART_ARCHIVE.md) like any other.

## Definitions and limits

- Tropical zodiac, apparent geocentric longitude, no precession correction. Sidereal or precession-corrected returns are not offered.
- The year is a **UTC calendar year**, 1 January 00:00 inclusive to the next 1 January exclusive. A solar year normally holds one return; because a tropical year is about 365.2422 days, a year can hold two (one in early January, one in late December) or none. All are listed; none is hidden or invented.
- The radix is the chart that was active when the panel opened and stays fixed until the panel is closed, so several returns can be cast from one list.
- Not included: returns of other bodies. A return shown in synastry can use the workspace's swap control to exchange the two charts.
- **Private testing only:** OpenStreetMap's public Nominatim policy limits aggregate use across an application and requires service switching without a software update. This single-device prototype throttles and caches locally but cannot enforce aggregate use or switch providers at runtime. Do not distribute or enable it for a wider user base until those service-policy requirements and attribution have been reviewed and met. The public tile server also requires normal browser caching and application identification.

**Difference from Regolo Alpha Leonis:** Regolo looked for the solar return nearest to the birthday in the requested year and stopped iterating within about 40 seconds of the exact instant. Here every return inside the UTC year is found and refined to under a millisecond of the provider's own longitude. Results can therefore differ from Regolo's by some seconds, and by which return is chosen for births in the first or last days of a year.

## Command

`return_search::find_returns` takes one `request` object: `protocolVersion`, `body` (`Sun` or `Moon`), `targetLongitudeDeg` (`0 <= value < 360`) and `year` (1600–2400). It carries no name, birth date or place. The response lists `{utcIso, julianDayUt}` in chronological order, or one of `provider_unavailable`, `invalid_request`, `calculation_failed`.

The search is plain numerics on top of the provider: it samples the longitude (daily for the Sun, every six hours for the Moon), brackets each passage from behind the target to ahead of it, and bisects to a tenth of a millisecond. It contains no astronomical model of its own and will work unchanged with the VirgoStars-Ephemeris adapter.

## Verification on 2026-11-15 (Windows 11)

- Rust: 8 search tests against uniform motion with a known answer (analytic instant, even spacing, half-open year boundaries, invalid input, missing or failing provider, calendar conversions) and 2 with the VirgoStars-Ephemeris provider and the real data files (skipped when they are absent) (the Sun returns to its J2000 longitude after 365.2422 ± 0.01 days and 2000 holds two returns; lunar returns are 26.5–28.5 days apart; residual longitude under 1e-6° and 1e-5°).
- Node: 8 contract and helper tests; the IPC allowlist reports 5 commands and 5 adapters.
- Native release build, driven through WebView2's local DevTools port with a fictional radix: the 2026 solar return's Sun longitude equalled the radix Sun to six decimals in an independent `calculate_chart` call; 14 lunar returns were found for 2026 and 13 for 2027; a solar and a lunar return were cast from the panel and drawn in synastry with the radix without renderer errors; an invalid year and an unknown body were refused.
- **Not done:** comparison with an independent ephemeris or with Regolo's own output for the same chart, relocated returns in the native window, years near the ends of the supported range, and a manual click-through by a person.
