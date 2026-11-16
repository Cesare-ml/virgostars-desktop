# Live current-sky chart refresh

**Status: prototype implementation on a focused feature branch.** This is a local presentation/update slice, not a claim that every supported ephemeris provider is scientifically validated.

## Behavior

- The explicit **Now at this place / Adesso in questo luogo** action marks the resulting chart as a live current-sky chart.
- While that chart remains active and the Desktop window is visible, the existing device wall-clock samples trigger a recalculation at most once per minute.
- The refresh uses the same local Rust `calculate_chart` provider path as a manual chart calculation. It does not introduce a second astronomy implementation, network request, or synthetic fallback.
- The chart's session identity remains stable across refreshes. Its calculated data and rendered wheel are replaced only after a successful response for the still-active chart.
- Ordinary natal charts, charts reopened from the SQLite archive, and previously calculated returns remain historical snapshots and are not refreshed.
- If a calculation fails, the last valid wheel stays visible; another attempt is made at the next minute boundary. Device-clock corrections are followed using wall time rather than accumulated timer duration.

## Boundaries and remaining acceptance

The `liveNow` flag belongs to the in-memory request/session model only and is deliberately not written to the chart archive. Saving a live chart stores its current UTC instant and freezes that session chart as a historical snapshot; the save action is disabled while a refresh is in flight. This does **not** yet satisfy the full startup experience: the user must open the chart form, choose a place and press **Now**. A remembered default place and automatic current-sky chart on application launch remain outstanding. The existing provider must be present and return a valid response; this feature does not make Swiss Ephemeris the default or imply that VirgoStars-Ephemeris is integrated. The local clock is not an ephemeris.

The minute boundary helper has isolated Node tests. Full `npm test`, Angular/Charts production build, Rust provider checks, and native Windows WebView2 visual smoke still need to be run from an authorized full checkout. Confirm manually that the visible live wheel changes on a later minute, that historical charts do not change, and that hiding the window prevents background recalculation.
