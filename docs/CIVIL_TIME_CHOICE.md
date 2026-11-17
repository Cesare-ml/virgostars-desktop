# Explicit civil-time choice before future natal calculation

**Status: isolated, locally tested helper; not connected to Angular forms, native Rust, or actual charts.**

The civil-time resolver may return two valid UTC instants during a daylight-saving rollback, or none for a skipped wall time. A chart request must never silently pick one.

`src/app/native/civil-time-choice.ts` adds `selectCivilInstant(input, resolveCivilTime, selectedUtc?)`. It invokes the current `resolveCivilTime` for **every** attempt rather than trusting a previously displayed options array. A unique valid instant may proceed without additional choice; ambiguous input returns `choice_required` with both exact UTC strings and their historical offsets. Only an exact candidate string is accepted, so editing the date, time, or time zone invalidates an earlier choice. Nonexistent or invalid wall times remain blocked.

A successful result preserves the originally entered local date/time, canonical IANA time-zone identifier, canonical UTC instant and historical offset seconds. `timeZoneSource: host_iana_unpinned` explicitly notes that the host's ICU/tzdb rules were used; it is **not** a versioned or independently verified tzdb, and the output is not a scientifically approved ephemeris request.

Before enabling actual chart calculation:

1. Add a UI that distinguishes ambiguous early/late instants and requires a user selection. Changing input must clear previous selection.
2. Forward the chosen UTC plus original civil inputs and timezone metadata to a reviewed native provider only after validation; store explicit provenance. Do not use `Date.parse()` of a local date string as a fallback.
3. Check the separate Rust provider's UTC/model/kernels/timezone limits. The engine can be narrower than the 1900–2100 civil-time parser (about 2033 with the USNO ΔT predictions); it then answers `out_of_range`.
4. Validate historical offsets against a pinned IANA tzdb across Windows/macOS and test genuine birth form flows with fictional fixtures.

## Verification

Executed on Node.js 22.16.0 with the current PR #52 resolver source:

```
node --experimental-strip-types --test tests/civil-time-choice.test.mjs
```

**11/11 passed**, covering Rome winter/fall/spring transitions, alternate DST choices, stale choices after input edits, malicious selection strings, Lord Howe and Kathmandu offset precision, Apia missing day, invalid dates and time zones. Standalone TypeScript 5.8.3 `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/native/civil-time.ts src/app/native/civil-time-choice.ts` **passed**.

Not executed: full npm suite, Angular compile, native Tauri/Rust integration, pinned tzdb cross-check, Windows WebView2 smoke, or astronomical accuracy comparisons. No source of real birth data, external datasets, network calls, user account operations, GitHub Actions, production modifications, merge or release.
