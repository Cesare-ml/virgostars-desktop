# Workspace layout — 2026-11-17

Status: **Prototype**, locally tested in the native Windows build (`npm run build:local`, see [Local full build](LOCAL_FULL_BUILD.md)); not a release.

## Structure

- **Chart first.** There is no top bar, chart header or footer. The wheel is as tall as the window (measured 99 % of the window height at 1360×880). Zoom, fit, save and PNG export float over the empty corners of the chart; the title, the chart's date and place and the device clock sit in the top corners.
- **Left navigation:** *Nuovo tema*, *Archivio*, the four chart modes, language and light/dark switches, and the attribution required by the licence. When the centre column would be narrower than the window is tall, the navigation folds to its icon rail by itself (`shouldCollapseNavigation`); once you fold or unfold it by hand, the window size no longer decides.
- **New chart** and **Archive** are two separate panels that open over the chart. The new-chart panel holds only the form and the *Save the chart in the local archive* checkbox (on by default). The archive holds the charts open in this session and the saved charts, with search, open and confirmed delete. See [Chart archive](CHART_ARCHIVE.md).
- **Right menu**, four tabs:
  - *Pianeti*: the house-system choice and one table — Lng (degrees, sign, minutes, seconds), Casa (Roman numeral for angular houses, coloured by element), Vel. (degrees per day) and Lat. The four angles lead the table. House cusps are not listed.
  - *Aspetti*: the aspect tables.
  - *Funzioni*: the function menu, grouped. Groups with something to run are open lists of buttons; everything not built yet waits in one closed list at the end.
  - *Impostazioni*: aspects, orbs and points; city search and city clock; language and theme.

## Captions

The technical captions (renderer, asset pack, runtime, cloud, account, laboratory) are no longer shown. Two things stay on purpose: the label *Posizioni illustrative, non calcolate* under the title while the demonstration wheel is on screen, so fictional positions are never mistaken for a calculated chart; and the licence attribution.

## Verification

Node tests (839, 12 skipped) and the offline bundle, privacy, security and IPC gates pass for both the synthetic and the private build. In the native local build, driven through WebView2's DevTools port with a fictional chart: city search found the place, the chart was calculated, saved, listed after a restart, reopened and deleted. Window sizes measured in the native build: the wheel is 98.9 % of the window height at 1280×720 and 1100×700 and 99.3 % at 1920×1080, with no page overflow; `npm run smoke:native` now fails if it drops below 95 %. Below 1140 px the inspector floats over the chart, so it starts closed there. In the dark theme the renderer paints its own grey square behind the wheel, which does not match the panel colour (renderer-owned, not changed). Not covered: accessibility review, a visual comparison against the older program.
