# New natal chart: temporary offline draft

**Status: prototype, locally tested on Windows; no real chart calculation or saved archive.**

The desktop shell provides a New natal chart panel for entering a name, Gregorian
date, optional time, and a city selected from the existing offline catalog. The
draft lives in memory while the app is open and is lost on exit. Switching
inspector tabs preserves the entered fields. The Reset button clears them. The
panel and Settings share the selected city during the session. No login or
network is required by this feature.

The form validates the calendar, time and place, preserves an unknown birth
time as unknown, and offers an input-only preview. It does not calculate a chart,
change the synthetic wheel, save personal data or communicate with a server.
The year range is 1–9999 in the proleptic Gregorian calendar, not an assertion
about historical local calendars. Rapid adjustments change the form only.

For a known time, an advisory UTC preview uses the already bundled
`moment-timezone` IANA data and displays its data version. Nonexistent local
times are rejected; repeated local times require an explicit choice. Historic
dates before 1970 and future rules carry cautions. This is not a validated
native timezone contract: a choice is not saved, and no UTC instant is passed
to an astronomical engine. Authoritative historical validation and a reviewed
storage and calculation flow are separate work.

## Provenance and boundaries

This slice adapts the in-memory natal draft from the existing desktop branch
`feat/native-offline-place-search-001` / PR #30. It uses the city's read-only
desktop picker and the existing Angular shell and chart renderer. The VirgoStars
web natal and archive components were reviewed; they depend on web services,
authentication and Angular Material and are not imported into this offline
slice. No new native IPC, cloud sync, authentication, credentials, local
personal-data database, asset distribution or dependency was added.

## Verification

- Node 22.18: full `npm test`, 165 tests passed, including synthetic civil-time
  and correction tests plus a test with bundled Europe/Rome IANA transitions.
- Angular production build and offline bundle verification passed using the
  existing Charts build and 392 generated synthetic image assets. Angular
  reports a `moment-timezone` CommonJS optimization warning.
- Windows Tauri debug/WebView2 smoke: opened the panel, entered fictional data,
  selected Roma from a local copy of the city catalog, and validated 27 October
  2024 at 02:30. The panel displayed both UTC candidates and accepted an
  explicit choice. The app used an isolated test identifier and synthetic art.
- A Windows installer, macOS, real astronomy, encrypted persistence, complete
  historical timezone accuracy and offline installation on a clean machine were
  not validated by this smoke test.

The existing broader PR #30 contains additional experiments that are deliberately
outside this slice. Coordinate future integration to avoid duplicating these
files or losing later fixes. The preferences PR #45 also touches the shell and
translations; reconcile it on integration. No merge or release is implied.
