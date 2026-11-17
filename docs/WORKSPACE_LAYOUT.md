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
- **New chart** and **Archive** are two separate panels over the chart ([Chart archive](CHART_ARCHIVE.md)).
- **Right panel**, no tab strip: the left menu (or the *Info pianeti* button on the chart) chooses what it shows, and its title says which.
  - *Info pianeti*: one table — glyph, Lng (degrees, sign, minutes, seconds), Casa (Roman numeral for angular houses, coloured by element), Vel. (longitude, degrees per day), Lat, Vel. Lat (latitude speed). The four angles lead it; house cusps are not listed.
  - *Aspetti*: each row is *symbol, symbol, symbol* (point, aspect, point) with the names on hover, then the orb and, where meaningful, **appl.** (applying: getting closer to exact) or **disappl.** (separating: moving away), explained on hover. Transit and synastry tables follow the same form.
- **Naviga cielo** (left menu, right panel): moves the chart on screen in time and place and redraws it as it moves (the calculation is repeated after a 70 ms pause, and only the latest request is shown). The date and time are shown in the chart's own time zone with an up and a down arrow per field (day, month, year, hour, minute); **Indietro / Avanti** step by the amount chosen in the grid (minutes 1 3 4 6 10 20, hours 1 4 6 7 12, days 1 7 15 30; 4 minutes first). Hours and minutes move by elapsed time; days, months and years keep the local clock time across daylight-saving changes. Years outside 0–5000 (astronomical numbering) are refused. Pressing **and holding** Indietro, Avanti or a field arrow keeps stepping (first step at once, repeat after 350 ms at one step every 90 ms), so the planets can be watched moving; releasing anywhere stops it. If the calculation engine cannot calculate a date, the clock goes back to the chart on screen, a held button stops and the panel says so. Opening it stops the sky from refreshing itself (the play button restarts it). Actions: **Imposta data/ora correnti**; **Cambia città** (a subject's chart keeps its local time in the new place, the sky keeps its instant); **Salva**, only for a subject's chart, writes the shown date, time and place over the chart in the archive after a confirmation (a chart not yet saved is simply saved); **Ripristina** returns to where navigation started or was last saved; **Erigi elettiva** asks for a name in an overlay (default "Elettiva YYYY-MM-DD HH:MM:SS") and saves a **new** chart under it. "Orario sconosciuto" of the old program is not built.
- **Funzioni** (drawer from the left menu) lists only what the left menu does not already offer: today the solar and lunar returns, then everything not built yet in one closed list (`functionMenu()` in `function-catalog.ts`).
- **Impostazioni** (drawer from the left menu) holds every setting, each in a spoiler of its own with its title aligned to the left, none repeated: *All'avvio mostra*, *Aspetto* (language, theme), *Domificazione*, *Aspetti* (which aspects are drawn, their orbs), *Elementi celesti* (which points are shown, take part in aspects, their orbs) and *Non ancora disponibili* (the settings of the old menu that are not built yet, disabled). There is no city search.

## Captions

The technical captions (renderer, assets, runtime, cloud, account, laboratory, demonstration) are not shown. The licence attribution stays.

## Verification

Node tests (882, 12 skipped) and the offline bundle, privacy, security and IPC gates pass. In the native local build driven through WebView2's DevTools port: the default start shows the current sky; the left menu, the drawers, the planet table (with latitude speed) and the symbol aspect lists render; choosing a saved chart as start chart shows it with the transits of the moment after a restart. In the dark theme the renderer paints its own grey square behind the wheel (renderer-owned, not changed). Not covered: an accessibility review, a visual comparison against the older program.
