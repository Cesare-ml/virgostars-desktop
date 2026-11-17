# Workspace layout — 2026-11-17

Status: **Prototype**, locally tested in the native Windows build (`npm run build:local`, see [Local full build](LOCAL_FULL_BUILD.md)); not a release.

## What opens first

There is no demonstration chart. When the program opens it shows, by the **start preference** (Settings → *All'avvio mostra*):

- **the sky of the moment** (default): the planets of this instant, cast at the place of the chosen start chart or, failing that, at Rome (`DEFAULT_SKY_PLACE`; planet positions do not depend on the place, only houses and angles do); or
- **my chart with the transits of this moment**: a saved chart chosen in the settings, shown with the sky of now around it.

The preference stores only a mode and the identity of a saved chart, on this device. If no ephemeris provider is built in, the stage says so and offers *Nuovo tema*; nothing is drawn from placeholder data.

## Structure

- **Chart first.** No top bar, header or footer. The wheel is as tall as the window (99 % at 1360×880, 98.9 % at 1280×720 and 1100×700, 99.3 % at 1920×1080). Zoom, fit, refresh, save and PNG export float over the empty corners; the title, the chart's date and place and the device clock sit in the top corners.
- **Left menu** (folds to an icon rail by itself when the centre column would be narrower than the window is tall, until the user decides): *Nuovo tema*, *Archivio*; *Cielo del momento* and the four chart modes; *Info pianeti*, *Aspetti*; *Funzioni*, *Impostazioni*; language and light/dark; the licence attribution.
  - *Funzioni* and *Impostazioni* open as a drawer from the left menu over the chart. Functions are grouped; groups with something to run are open lists, everything not built yet waits in one closed list.
  - *Impostazioni*: the start preference, aspects/orbs/points, appearance. There is no city search.
- **New chart** and **Archive** are two separate panels over the chart ([Chart archive](CHART_ARCHIVE.md)).
- **Right panel**, two tabs, opened from the left menu or from the *Info pianeti* button on the chart:
  - *Info pianeti*: house system and one table — glyph, Lng (degrees, sign, minutes, seconds), Casa (Roman numeral for angular houses, coloured by element), Vel. (longitude, degrees per day), Lat, Vel. Lat (latitude speed). The four angles lead it; house cusps are not listed.
  - *Aspetti*: each row is *symbol, symbol, symbol* (point, aspect, point) with the names on hover, then the orb and, where meaningful, **appl.** (applying: getting closer to exact) or **disappl.** (separating: moving away), explained on hover. Transit and synastry tables follow the same form. Glyphs of the points are the wheel's own; an aspect without a drawn glyph uses a written symbol (☌ ☍ △ □ ⚹ …).

## Captions

The technical captions (renderer, assets, runtime, cloud, account, laboratory, demonstration) are not shown. The licence attribution stays.

## Verification

Node tests (850, 12 skipped) and the offline bundle, privacy, security and IPC gates pass. In the native local build driven through WebView2's DevTools port: the default start shows the current sky; the left menu, the drawers, the planet table (with latitude speed) and the symbol aspect lists render; choosing a saved chart as start chart shows it with the transits of the moment after a restart. In the dark theme the renderer paints its own grey square behind the wheel (renderer-owned, not changed). Not covered: an accessibility review, a visual comparison against the older program.
