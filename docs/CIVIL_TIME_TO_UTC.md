# Civil time → UTC boundary for future natal calculations

**Status:** locally tested, isolated TypeScript prototype. This is **not** an integrated ephemeris, timezone-data release, UI workflow or native IPC command.

## Problem

A local birth time plus an IANA time zone does **not** always identify one UTC instant. A daylight-saving rollback can produce two legitimate instants; a spring-forward jump or international-date-line change can make the civil time nonexistent. Silent selection or `new Date(localString)` conversion can produce a wrong natal chart.

## Implementation

`src/app/native/civil-time.ts` exports `resolveCivilTime({date, time, timeZone})`. It:

- Accepts a strict Gregorian `YYYY-MM-DD` date in **years 1900–2100**, `HH:mm` or `HH:mm:ss` with seconds from `00` through `59`, and a valid IANA identifier recognized by the executing host.
- Uses the host-provided `Intl.DateTimeFormat` IANA timezone rules. It examines offsets across a bounded ±48-hour window around the nominal local timestamp (97 hourly probes), then validates every candidate UTC instant against the originally requested calendar date and wall-clock time.
- Returns `resolved` with an explicit UTC instant and east-of-UTC offset in **seconds**, `ambiguous` with *all* matching sorted instants, `nonexistent` when none match, or `invalid` with a stable error code. Historic offsets are not rounded to minutes.
- Does not choose a DST disambiguation policy, shift nonexistent times, guess a time zone from coordinates or silently convert to the device's local zone.
- Has no network calls, persistence, account access, privileged IPC, astronomical calculations, external dependencies or logging of personal data.

## Intended use after integration

1. Select a city with verified IANA time zone provenance. Present the entered calendar date and time explicitly as **local civil time**.
2. Call `resolveCivilTime` locally. For `ambiguous`, show the actual UTC choices and both offsets and require an explicit choice; for `nonexistent`, ask the user to correct the time. Invalid input blocks calculation.
3. Pass only a selected, exact `instantUtc` to the future calculation queue/native Rust ephemeris request. Preserve the original civil input, selected offset, zone identifier and timezone database provenance alongside the chart so a later OS tzdata update cannot silently recalculate a different historical instant.
4. Independently validate UTC/time-scale/zone support and the engine's supported dates in the native boundary. An Angular preview validator alone is **not** a security or scientific correctness guarantee.
5. Keep synthetic guest mode clearly separate from verified astronomical results; do not replace unavailable positions with invented values.

## Deliberate limitations and acceptance gates

- **Years 1900–2100, Gregorian only.** Narrowed on 2026-11-17 from 0–5000 to the range the VirgoStars-Ephemeris engine is validated for ([provider](VIRGOSTARS_EPHEMERIS_PROVIDER.md)); 0–5000 stays a goal for later. The Julian calendar, earlier dates, leap seconds and uncertain historical zone data are not covered, and no historical zone rule is verified here. Do not claim full astrology historical coverage.
- Depends on the timezone database packaged with the runtime (Node/Chromium/OS ICU). Data can differ between machines and after updates. This is a local conversion helper, not a version-pinned tzdata bundle or an independent proof of historical timezone accuracy. A future local catalog integration needs a tzdb source/version and regression evidence per operating system.
- The hourly offset survey covers common IANA transition behavior including date-line jumps but is **not** a formally proven exhaustive resolver for every pre-standard historical timezone. Before shipping, cross-check independently with a pinned IANA tzdb and expand the accepted historical calendar range only with tests.
- The 97-probe synchronous computation is suited to an individual edit, not every frame of a live chart. Cache only with an explicit provenance policy; do not run inside a frequent rendering loop.
- Not wired to the draft queue/native calculation-probe PRs #47/#48 or to UI forms; those separate changes require API alignment, integration tests and Windows WebView2 testing.

## Local tests actually run

On Node.js **22.16.0**:

```powershell
node --experimental-strip-types --test tests/civil-time.test.mjs
```

**16/16 passed.** Coverage: winter/summer Rome, both Italian DST transitions and precise boundaries, Kathmandu 45-minute offset, Lord Howe 30-minute rollback, negative UTC offsets, Apia's missing calendar day, historical second offsets, Gregorian leap-year checks, invalid civil input, strict zone validation and independent parallel calls.

TypeScript **5.8.3** strict compilation also passed:

```powershell
tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/native/civil-time.ts
```

**Not run:** complete desktop `npm test`, Angular package build, native Rust/Cargo, Windows or macOS WebView2, external tzdb parity, authentic ephemeris/Horizons comparisons. No production data, distribution, GitHub Actions or licensing changes.
