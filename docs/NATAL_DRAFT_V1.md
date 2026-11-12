# New natal chart — in-memory guest draft v1

**Status: typed in-memory draft plus preliminary offline IANA UTC preview implemented in source; not yet native-built or released. No persistence or real astronomical calculation.** See [NATAL_TIMEZONE_RESOLUTION.md](NATAL_TIMEZONE_RESOLUTION.md) for explicit DST gap/fold choices, data-version caution and validation requirements.

## What this vertical slice does

In the desktop chart-first shell, **New natal chart / Nuovo tema** is accessible through the left navigation and a fourth inspector tab. The user can enter a subject name, Gregorian year/month/day (currently years 1–9999), optionally a known birth hour/minute, or mark the time unknown. The same locally queried city picker can provide the selected *source ID*, original name, state ID, verified country label/ISO code when available, region, exact integer-microdegree coordinates and source IANA-style timezone.

The form is **in-memory only**. Navigating to another inspector tab retains the current edits within the app session; Reset clears them. Clicking **Validate preview** produces a typed snapshot of user-entered civil date/time and chosen city. The preview is **not a calculated natal chart** and **never modifies the synthetic Three.js wheel**. A separate advisory UTC preview now uses the bundled IANA zone transitions for known hours: unique UTC, nonexistent time (gap), or a fold requiring explicit selection. The original `NatalDraftPreview` still contains **no authoritative saved UTC instant**.

No \`localStorage\`, \`sessionStorage\`, IndexedDB, HTTP call, server account or unencrypted SQLite chart store is used. Nothing is uploaded, saved or silently synchronized. Closing the app loses this temporary data. A real guest archive is a separate security-reviewed milestone; don't imply this demo persists records.

## Typed v1 contract

\`src/app/natal-draft-state.ts\` defines:
- \`NatalDraftState\`: bounded form input, selected offline place, validation errors and ephemeral preview
- \`LocalBirthCivil\`: calendar date, optional hour and minute, **birthTimeKnown** flag
- \`PlaceSnapshot\`: \`source='owned-world-cities'\`, original source ID, country/state/region/name, exact microdegrees and IANA timezone string where present
- \`NatalDraftPreview\`: versioned user-supplied snapshot and \`utcResolution\` explicitly \`pending_historical_tzdb\` or \`unknown_birth_time\`. **It intentionally contains no UTC timestamp, ascendant, houses, planetary positions, astronomical certainty or saved ID.**

The complete snapshot is copied from the current fields so a later text edit does not mutate previously previewed values. Every edit immediately invalidates the old preview. A subject name is a user-visible label, not a unique identity.

## Validation limits (not astronomical accuracy)

- Gregorian calendar year 1–9999 only, including valid leap day and century exceptions; no unsupported BCE or historical calendar cutover is silently assumed.
- Birth time known → integer 24-hour hour 0–23 and minute 0–59 required. Unknown time → both values **null**, not arbitrary 12:00 or a fabricated Ascendant.
- Place must have a stable positive source ID and valid microdegree latitude/longitude. Country fields must have the same verified structure as the v1/v2 offline place-search response.
- Birth time known → a plausible **IANA timezone identifier string** is required. **This is only syntactic validation, not authoritative zone existence nor historical DST**. The software must resolve gaps/folds and actual UTC using a versioned IANA timezone database before calculation and save.
- Preview requires a bounded non-empty name. Input is limited in memory; UI displays validation errors in Italian/English.
- The selected location may have a missing country mapping in v1. That is shown as unknown rather than guessed; lack of country name does not invalidate a place's coordinates/source ID.
- Date input remains the user's original local **civil** values. Editing or switching locations must explicitly decide whether a time change preserves wall time or the absolute instant once timezone conversion exists.

## UI and security acceptance

- [x] Draft model/source + UI fields authored in the desktop Angular shell; shares chosen city with the Settings/Parametri picker, no attempt to re-render the synthetic chart.
- [x] Italian/English messages including "unsaved", "not calculated", "historical timezone unresolved" and "unknown birth time".
- [x] Pure Node test cases authored for leap dates, invalid fields, unknown time, stale preview, place snapshot, source IDs and no-storage boundary.
- [ ] **Execute** all new Node tests, run full Angular build and native Windows test; these have not yet been performed for this patch.
- [x] **Provisional** local timezone preview for known hours added: explicit gaps/folds, TZDB version label and historical caveats; 13 synthetic Node tests and strict type check passed on matching GitHub blobs. See [timezone resolution](NATAL_TIMEZONE_RESOLUTION.md).
- [ ] **Authoritative** versioned IANA resolver/parity with Rust, gap/fold selection persistence and historical accuracy review before durable chart saves. A plausible IANA zone string alone remains insufficient.
- [ ] Integrate validated Rust VirgoStars-Ephemeris with actual ephemeris kernels and source accuracy; no synthetic chart mislabeled as natal.
- [ ] Real encrypted SQLite/SQLCipher guest archive with locally provisioned key, migration/backup/restore, stable UUIDs, save/update/reopen/search and no login.
- [ ] Source-country table export and full 1,951,599-city private pack Windows QA, including licensed redistribution.
- [x] Five in-memory date/time +/- correction controls and bounded press-and-hold **implemented in source**; isolated Node smoke tests and TS strict validation passed; see [rapid correction](NATAL_RAPID_CORRECTION.md). Calendar correction clears this preview and does not recalculate the fictional chart.
- [ ] Native Windows/Angular hold controls validation, configuration of larger step sizes, bounded Rust astronomy IPC + real continuous chart animation and approved local Save.

## Cross-repository boundary

- **virgostars-desktop** owns form/validation/guest UX, typed Rust IPC and eventual secure archive.
- **VirgoStars-Ephemeris** owns astronomy, time-scale/planet calculations and ephemeris kernel accuracy.
- **astrological-functions** owns astrology-specific domain composition/aspects from Rust astronomy outputs.
- **astrological-charts** owns Three.js renderer and animation-capable updates (no duplicate canvas implementation).
- **Public city catalog** is read-only reference data; it is **not** the user's encrypted personal archive.

**No real personal chart should be entered into the experimental build unless the user understands it is an unsaved in-memory form.** There is no automatic cloud sync, account requirement, access to birth records or automatic merge. No GitHub Actions or main merge.
