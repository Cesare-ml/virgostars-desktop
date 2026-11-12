# Natal civil-time → UTC preview: DST gaps, folds and IANA provenance

**Status (2026-11-12):** pure deterministic resolver and its Angular natal preview are authored; standalone Node tests (13/13) and strict TS type check passed on exact GitHub source/test blobs. This is **not** an approved native historical timezone conversion, a saved natal instant, or live astronomy.

## Purpose

The app must never map a birth's local civil hour to UTC by applying the city's current PostgreSQL `tz_offs` or by asking the computer's local timezone. It must distinguish:

- **Unique:** one unambiguous UTC candidate.
- **Nonexistent local time (spring gap):** zero candidates; do not silently move the civil hour forward.
- **Repeated local time (autumn fold):** two or more candidates, ordered chronologically; the user **must explicitly choose** the intended occurrence.
- **Unknown birth time:** no UTC instant, no fabricated noon, Ascendant or houses.
- **Missing/unrecognized/invalid zone:** no UTC guess and a clear error.
- **Before 1970 / far future:** warning that historical rules may not represent the actual locality / predicted future law may change.

No online service, account, GPS, current UTC offset, React or external worker is required.

## Implementation boundaries

| Source | Responsibility |
| --- | --- |
| `src/app/timezone-civil.ts` | Pure inversion of civil time using immutable TZDB interval arrays; stable, bounded results, deterministic validation |
| `src/app/timezone-moment-preview.ts` | Adapter to the **already installed** `moment-timezone` data bundle; uses `moment.tz.zone(id).untils/offsets` and `moment.tz.dataVersion`, never the convenience local-time parser |
| `src/app/natal-draft.component.ts/html/css` | Preview result, gap warning, two candidate buttons for a fold, automatic selection only for unique time, visible data version and pre-1970/future cautions |
| `src/app/natal-draft-state.ts` | Untouched in-memory birth record and original civil fields; `NatalDraftPreview.utcResolution` remains `pending_historical_tzdb` until authoritative validation |
| `tests/timezone-civil.test.mjs` | 13 deterministic cases using synthetic zone transitions; no purchased city records |

### Algorithmic detail

Moment Timezone's unpacked zones store ordered `untils` (UTC ms transition boundaries) and `offsets` (minutes **west** of UTC). To resolve wall time `W`, for each unique offset `o` produce a candidate `U = W + o * 60,000`. Accept only candidates that lie inside a zone interval whose offset exactly equals `o`. Use binary search for interval lookup. Zero valid UTC values indicates a gap; multiple indicates a fold. This avoids Moment's documented behavior of **skipping forward over nonexistent local times and choosing one repeated hour automatically**.

The Gregorian year-0-to-99 JavaScript Date UTC pitfall is handled with `setUTCFullYear`, and historical fractional-minute offsets can preserve UTC seconds. The pure module inspects a finite bounded number of offset values, returning at most a few small candidates; it does not accumulate database rows, network requests or renderer objects.

Documentation source: https://momentjs.com/timezone/docs/

### Version and accuracy caveats

- Desktop currently declares `moment-timezone: ^0.5.46`. The 0.5.x release line predates some 2026 IANA updates; `0.5.46` bundled IANA `2024b`, and `0.5.48` bundled `2025b`. **The exact installed version is not pinned by a committed lockfile here**. UI reads and displays `moment.tz.dataVersion` so it cannot silently claim the newest rules.
- IANA does **not guarantee complete historical pre-1970 local civil-time accuracy**. See https://www.iana.org/time-zones/theory. Retain original wall time, place source ID, coordinates and timezone string for future correction.
- Changes to government future time-zone law may invalidate stored future UTC values. A durable chart must record the authoritative tzdb release used to resolve time plus user fold selection.
- The preview adapter is **not** the final authority for a saved chart. Before enabling Save, supply a versioned, approved offline timezone resolver shared with the Rust calculation backend, compare known gap/fold fixtures and implement a migration/provenance policy. Do not silently replace an already saved birth instant after tzdb updates.
- Do not upgrade Moment Timezone, add HTTP timezone lookups, or include private city data without a separate tested dependency/licensing decision.

## Synthetic numerical examples

| Civil input | Zone | Expected result |
| --- | --- | --- |
| 2012-03-11 02:30 | America/New_York | nonexistent local hour |
| 2012-11-04 01:30 | America/New_York | two choices: 05:30Z / 06:30Z |
| 2024-03-31 02:30 | Europe/Rome | nonexistent local hour |
| 2024-10-27 02:30 | Europe/Rome | two choices: 00:30Z / 01:30Z |
| 2024-08-09 12:00 | Europe/Rome | unique 10:00Z |
| 0050-06-05 12:00 | UTC | unique 0050-06-05T12:00Z; historic warning |
| Unknown birth hour | Any valid zone | no UTC instant |

These tests use synthetic transition arrays built from published DST boundary examples, not records exported from the owner's purchased city database.

## Acceptance gate before saved real natal chart

- [x] Pure resolver + 13 deterministic Node tests run on Node 22.16.0, exact source and test SHA hashes matched committed GitHub blobs; TypeScript strict module check passed.
- [x] Angular preview receives bundled IANA data and shows explicit fold choices; **source wired but not yet native-verified**.
- [ ] Execute the full repository `npm test` and Angular build with the installed Moment Timezone version.
- [ ] Run Windows WebView2 native GUI and keyboard/accessibility checks, including gap/fold choice and switching tabs.
- [ ] Record the actual bundled `moment.tz.dataVersion`, compare native Rust IANA/TZDB provider parity, plus problematic historical epoch/country cases.
- [ ] Connect a validated UTC instant to VirgoStars-Ephemeris real calculations, keeping natal and transit clocks separate.
- [ ] Persist only after encrypted local guest archive, explicit fold choice, proper ID and time-zone provenance, recovery/backup and no-login use are reviewed.

**The existing synthetic chart, the person's natal birth details, and local city catalog remain unchanged by this UTC preview.**
