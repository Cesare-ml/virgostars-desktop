# VirgoStars Desktop — Offline-first usable MVP (priority decision)

**Approved product direction: 2026-11-11. Status: REQUIREMENTS / NOT IMPLEMENTED IN THE CURRENT BINARY.**
This is the **near-term MVP**, not a reduction of the complete long-term astrology feature catalog currently proposed in separate PR #6. Do not describe prototype screens as released features.

## Non-negotiable principles

1. **Absolutely no VirgoStars account, login, online activation or Internet connection required** to install, open, create, calculate, render, save, search, edit or export local natal charts. An optional account later unlocks cloud synchronization; the app never requires registration merely to work.
2. On launch, open a **current-sky/Adesso** workspace with a real-time clock and an honest location indicator. A correctly computed topocentric chart requires a known location. On first run without one, ask for an offline city or manual coordinates; do not silently assume GPS, a server, an invented position or a particular city. The clock and other valid location-independent views may still run.
3. Core calculations are **offline** via original `VirgoStars-Ephemeris` Rust, astrology/domain composition via `astrological-functions`, visualization through `astrological-charts` and approved assets. Never copy a legacy third-party astronomy engine or make an HTTP call per time step.
4. **Professional chart-first design:** the center chart is as large as available at all times, light and dark skins, collapsible navigation and inspector. Time correction and live controls must not obscure the chart.
5. User-owned local work is durable even without an account. Saving is **explicit**, and navigating a preview or playing time does not silently rewrite a saved chart.
6. Validate a feature's astronomy/calculation accuracy and supported time range before enabling its actual UI; do not pass synthetic demo values as computed sky positions.

## P0 — First genuinely usable offline release candidate, ordered

| ID | Functional work | Completion / acceptance |
| --- | --- | --- |
| MVP-01 | Stabilize packaged Angular/Tauri CSS, chart center/max size and WebGL lifecycle; light/dark and PNG | Native Windows screenshot shows actual styled app; valid local data/graphical assets; no external server |
| MVP-02 | Implement versioned high-throughput, bounded Angular ↔ Rust calculation lane | Repeated fast click/hold/drag works without unbounded IPC queues, stale frames, memory growth or freezing; metrics recorded |
| MVP-03 | Local `Adesso` and accurate clock | Clock advances independently of calculation; current chart refreshes automatically using locally computed ephemerides, selected city and zone; no Internet |
| MVP-04 | Time correction (Correzione tema) | Editable year/month/day/hour/minute, plus/minus, configurable step, click-and-hold acceleration, pause, preview, reset, save; validates calendar/DST |
| MVP-05 | New natal chart | Name, optional notes/group, civil date/time (including unknown time), city/manual coords, IANA timezone; preview; save without login |
| MVP-06 | Local archive | Create/read/edit/duplicate/delete with confirmation, search, sort, groups and notes, reopen; deterministic local IDs, transactional persistence |
| MVP-07 | Selected natal chart + transits | Two independent timelines: static natal radix and adjustable/live transit time; visible inter-ring aspects and explicit time labels |
| MVP-08 | Essential settings | House system, active celestial bodies/points, aspect families and filters, `aspetti verso`, per-body and per-aspect orbs, graphical elements/layers, language and skin; persisted offline |
| MVP-09 | Offline city search | Bundled license-reviewed, versioned city/place index + correct location/timezone lookup for natal dates; manual override; offline-first |
| MVP-10 | Native performance/quality gate | Manual Windows offline run, numerical comparisons against approved fixtures, keyboard/contrast tests, rapid inputs, memory profiling and crash recovery |

**P0 means first priority**, not a promise that the current Rust ephemerides already compute every required output. Implement vertically: P0 user intent with transparent capability gaps and non-fake results.

## P0 UX details, per view

### Adesso / real-time chart
- Display a digital clock with seconds, timezone label, source (device clock), optional UTC offset and selected city. Tick UI independently of ephemeris computations. Update the plotted sky at an accuracy-appropriate cadence (initial candidate: per minute for ordinary live mode), with an explicit last-computed time.
- Buttons: Now / pause / resume, time +/− and speed selector. Switching to preview freezes the chosen instant; returning to Now must explicitly resync with the clock, not overwrite a saved birth time.
- Preserve location and last selected skin/settings between launches. Never track precise location without explicit user consent; user-selected city is the default. Handle device clock changes, resuming from sleep, timezone/DST transitions and loss of a required local ephemeris kernel.

### Correzione tema / live date-time scrub
- Numeric fields for **year, month, day, hour, minute** (plus optional seconds for real-time display), editable directly and via adjacent +/− controls; configurable stepping across 1m, 5m, 10m, 1h, 1d, 1mo, 1y and custom user-selected increments.
- Pointer press: one immediate step, then repeat only after a short deliberate hold; release, pointercancel, blur, losing visibility or Escape stops repeats reliably. Keyboard and accessible controls equivalent. Keep hold-repeat and actual calculations on separate clocks.
- Repeated quick taps and long holds move sequentially in the selected timeline. Display the **current desired time immediately**, even while calculations lag. An obsolete result can never replace the newest selection. Do not promise to display every intermediate computed chart under a saturated GPU.
- Calendar units follow defined civil-time behavior (e.g., month boundaries and invalid 31st; DST nonexistent/ambiguous local times); specify whether step is elapsed UTC time or wall-clock time and offer clear disambiguation. Never silently shift a historical natal instant.
- Preview changes are unsaved until `Save`. `Reset` returns to last saved state; `Cancel` leaves it unchanged. Selecting a place can preserve either the absolute instant or the displayed wall time, with an explicit choice when the meanings differ.

### New / edit / archive
- Model chart **subject** separately from one or more **views** (radix, transit, settings/presentation); allow multiple saved charts with the same display name. Never use the name alone as an identifier.
- Form fields: subject name, optional groups/tags, notes, ISO civil date/time, unknown birth-time flag, city ID + country/region, lat/lon, IANA timezone ID, UTC instant or explicitly unresolved time. Preserve original location/time source and edition metadata.
- Unknown birth time: show bodies where valid, but mark houses, axes and derived components unavailable or conditional; never present noon-based ascendant as an exact result.
- Local archive first: full-text name search, group filter, sort, create, edit, duplicate, delete with confirmation, recently opened, optional export/import and backup. Use stable UUID/local IDs and schema versioning. Don't block using the archive behind login.
- Protect against process crashes in mid-save, interrupted migrations and unreadable storage. Document backup/restore and secure deletion limitations before real records.

### Selected chart and transit chart
- Natal positions, houses and recorded birth time/location remain unchanged when navigating **transit** time; transit UTC/location and selectable location are separate fields.
- Hover/click a natal planet → show **aspects between that natal body and transit bodies**; hover/click a transit planet → show its aspects to natal bodies. Expose the same selection programmatically from Angular to `astrological-charts`, and use keyboard/table alternative. Render aspects with validated orb/type/applying data, not invented results.
- Chart skin and UI skin can be selected consistently while keeping readable glyph contrast in both modes.

### Settings, calculations and graphics
- Catalog-driven toggles for celestial bodies, lunar nodes/apogees/perigees, angles, lots and supported points; per-body **visible**, **participates-in-aspects** (`aspetti verso`) and **body orb**; per-aspect enabled flag and **aspect orb**, plus applying/separating display only if calculated.
- Show aspects by type, radial layer, color/line style and filtered aspect families. Default settings and named presets survive offline restart. UI settings can be changed without destroying computed positions; calculate again only when a computational input actually changed.
- House systems: **standalone Egyptian** plus every supported Swiss-reference-compatible system implemented/tested in `VirgoStars-Ephemeris`, following the separate [house-systems requirements in PR #6](https://github.com/Cesare-ml/virgostars-desktop/pull/6). **Never include the Egyptian+Placidus hybrid.** Unsupported systems appear as disabled with an explanation, never silently substitute another.
- Elemental/graphical views (including existing element-rendering patterns), planet information popover (sign, longitude/latitude, speed, retrograde, houses where valid, relationships and orb), configurable graphical details/labels and color tokens. Never conflate drawing/rendering settings with astronomical computations.
- Current-first P0: no advanced specialist features need delay the usable archive/clock. Keep the full future F01–F08 backlog and explicit exclusions in PR #6 rather than copy every specialist module into this MVP.

## Deferred to separate phase (P1: optional cloud)
- VirgoStars sign-in, profile mapping, sync/backup, cloud conflict resolutions and migration of existing local-only charts. **None may become a prerequisite for P0 usage.**
- Design details and the no-loss reconciliation flow: [OPTIONAL_SYNC_AND_DUPLICATES.md](OPTIONAL_SYNC_AND_DUPLICATES.md).
- Local city data works offline regardless of optional online enrichment: [OFFLINE_PLACES_AND_TIMEZONES.md](OFFLINE_PLACES_AND_TIMEZONES.md).
- Native performance architecture: [LIVE_CALCULATION_PIPELINE.md](LIVE_CALCULATION_PIPELINE.md).

## Research and provenance boundaries
The historical private frontend was inspected **as a behavioral reference only**: it contains a time and location selector with hold-repeat, chart CRUD, archive/group/notes, clock, planetary detail and settings including per-body/per-aspect orbs. Do not import its branding, code, assets, credentials or unreviewed ephemeris implementation into VirgoStars Desktop. Existing newer repositories are authoritative.

**Explicit status:** only the synthetic Windows .exe startup and local Angular↔Rust capability probe are observed; local true-sky computation, archive, live correction and guest mode are **not yet implemented**.
