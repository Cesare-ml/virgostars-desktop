# Aspects, orbs and celestial points

**Status: Prototype / locally tested (2026-11-15).** Not released.

## What it covers

Five entries of the Regolo Alpha Leonis settings menu: **Aspetti**, **Orbite Aspetti**, **Orbite Pianeti**, **Aspetti Verso** and **Elementi Celesti**.

- **Parametri** tab: switch each of the 17 aspects on or off and give it an orb; for each point choose whether it is drawn, whether it takes part in aspects, and its orb; hide or show the aspect lines; restore the defaults.
- **Aspetti** tab: the aspect table of the active calculated chart, with the distance from exactness and an A/S mark for applying or separating.
- **Prototype:** in transit and synastry modes, a separate cross-chart table uses the current aspect/point settings. It compares **sky → active chart** for transits and **active chart → second chart** for synastry. The second point supplies the orb, capped by the aspect orb; equal point names and axes may be paired across charts. The tables do not claim parity with the renderer's lines.

Not covered: Focus Aspetti, the applying/separating drawing style of Regolo's "Applicazioni", "Transaturnini se in congiunzione", and the lots.

## Defaults

The ones Regolo starts with: conjunction, opposition, trine, square and sextile active; every point with a 6° orb; quintile and semisquare capped at 3°, quincunx and the two Phi aspects at 2°; Uranus, Neptune, Pluto and Chiron drawn but not aspected; mean node and mean apogee hidden; true node, osculating apogee and the four axes drawn and aspected.

This changes what the prototype drew before: the trans-Saturnians no longer form aspects by default, and the axes and the true nodes now do.

## The rule

The table uses the same rule as the Charts renderer, so that it describes the lines on screen:

1. Points are taken in the renderer's fixed order (planets, Chiron, MC, IC, AS, DS, apogee and perigee, nodes).
2. Both points of a pair must take part in aspects. Axes are always candidates when the chart has houses.
3. The orb is that of the **second** point of the pair in that order, reduced to the aspect's own orb when one is set and smaller. The limit itself is excluded.
4. Parallel and contraparallel of declination use a fixed 1° orb.
5. Axes are never aspected with axes, and a point never with its own opposite (north and south node, apogee and perigee).

Point 3 means that with unequal point orbs the result depends on the order of the pair. That is the renderer's behaviour, reproduced here on purpose and stated in the interface.

**Applying or separating** is derived from the daily motions in longitude; axes are treated as fixed, so a planet near an axis is "applying to" it. It is not stated for exact aspects, for pairs with no relative motion, or for declination aspects (declination motion is not part of the chart data).

For transit comparisons the natal point is fixed and only the sky point moves; an A/S mark is omitted for a sky axis because its speed is unavailable. Synastry compares two independent snapshots and never assigns an A/S mark. These are prototype presentation rules, not independently validated astrological methods.

Angular arithmetic comes from `astrological-functions`. The pairing rule and the applying test live in `src/app/astro/aspects.ts`; they are astrological method and should move to `astrological-functions` in a separate, authorized change.

## Known differences from the renderer

Found while reading the built Charts library; not changed here, to be raised upstream:

- **Phi aspects.** The renderer tests "first point plus the angle equals the second" without wrapping at 360°, so it misses a Phi aspect that crosses 0° Aries. The table wraps correctly and can therefore list a Phi aspect the chart does not draw. Both Phi aspects are off by default.
- **Trans-Saturnians when conjunct.** The renderer reads `settaggi.transaturniniSeCongiunti`, while its settings class defines `transaturnini_se_congiunti`; the option has no effect, so it stays listed as planned.

## Storage

Settings are device-only display preferences with no personal data, kept in WebView local storage under `virgostars.desktop.chart-settings.v1`. Loading is field by field: valid values are kept, anything unknown, missing or out of range falls back to its default, extra keys are dropped. A failed read or write never blocks the chart.

## Verification on 2026-11-15 (Windows 11)

- Node: 7 settings tests (defaults, sanitizing, hostile input, save and load, failing storage, typed orbs) and 10 aspect tests (major aspects, wrap at 0°, orb of the second point and aspect cap, exclusions, applying and separating including retrograde motion, Phi direction, declination parallels, point order).
- Native release build, driven through WebView2's local DevTools port with a fictional J2000 chart: 20 aspects listed with the defaults (the Sun–Saturn trine at 0°01', which matches the two longitudes); enabling the quincunx, aspecting Uranus and setting the Moon's orb to 3° gave 25 and redrew without renderer errors; an orb of 99 was refused and the previous value kept; hiding the lines kept the table and said so; the settings were still in force after closing and restarting the application; restoring the defaults returned to 20.
- **Not done:** a line-by-line comparison between the drawn aspect lines and the table (the renderer exposes no list), the demonstration chart with changed settings, export of a chart with aspects, and a manual click-through by a person.
