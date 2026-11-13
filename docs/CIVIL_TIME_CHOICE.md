# Explicit civil-time choice before future natal calculation

**Status: isolated, locally tested helper; not connected to Angular forms, native Rust, or actual charts.**

The civil-time resolver may return two valid UTC instants during a daylight-saving rollback, or none for a skipped wall time. A chart request must never silently pick one.

`src/app/native/civil-time-choice.ts` adds `selectCivilInstant(input, resolveCivilTime, selectedUtc?)`. It invokes the current `resolveCivilTime` for **every** attempt rather than trusting a previously displayed options array. A unique valid instant may proceed without additional choice; ambiguous input returns `choice_required` with both exact UTC strings and their historical offsets. Only an exact candidate string is accepted, so editing the date, time, or time zone invalidates an earlier choice. Nonexistent or invalid wall times remain blocked.

A successful result preserves the originally entered local date/time, canonical IANA time-zone identifier, canonical UTC instant and historical offset seconds. `timeZoneSource: host_iana_unpinned` explicitly notes that the host's ICU/tzdb rules were used; it is **not** a versioned or independently verified tzdb, and the output is not a scientifically approved ephemeris request.

Before enabling actual chart calculation:

1. Add a UI that distinguishes ambiguous early/late instants and requires a user selection. Changing input must clear previous selection.
2. Forward the chosen UTC plus original civil inputs and timezone metadata to a reviewed native provider only after validation; store explicit provenance. Do not use `Date.parse()` of a local date string as a fallback.
3. Check the separate Rust provider's UTC/model/kernels/timezone limits. The experimental DE441 `first_sky` window is presently narrower than the 1900–2100 civil-time parser.
4. Validate historical offsets against a pinned IANA tzdb across Windows/macOS and test genuine birth form flows with fictional fixtures.

## Verification

Executed on Node.js 22.16.0 with the current PR #52 resolver source:

```
node --experimental-strip-types --test tests/civil-time-choice.test.mjs
```

**11/11 passed**, covering Rome winter/fall/spring transitions, alternate DST choices, stale choices after input edits, malicious selection strings, Lord Howe and Kathmandu offset precision, Apia missing day, invalid dates and time zones. Standalone TypeScript 5.8.3 `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/native/civil-time.ts src/app/native/civil-time-choice.ts` **passed**.

Not executed: full npm suite, Angular compile, native Tauri/Rust integration, pinned tzdb cross-check, Windows WebView2 smoke, or astronomical accuracy comparisons. No source of real birth data, external datasets, network calls, user account operations, GitHub Actions, production modifications, merge or release.

## Stable civil-input snapshot (2026-11-13)

Before invoking the injected civil-time resolver, `selectCivilInstant` now snapshots `date`, `time` and `timeZone` exactly once into a detached frozen object. The resolver reads that captured tuple rather than an accessor-backed or concurrently edited caller object; selected `localDate` / `localTime` labels come from the **same** captured values. Getter exceptions and resolver exceptions fail closed with the existing sanitized `TIME_ZONE_UNAVAILABLE` invalid state; missing/non-object input uses `INVALID_LOCAL_DATE`. This is not an independent validation of the resolver's candidate list or a pinned tzdb check.

New synthetic test: `tests/civil-input-snapshot.test.mjs` exercises single getter reads, independent input references, mutation attempts, throwing getters, absent input and unchanged DST choice rules.

**Executed:** Node.js 22.16.0 `node --experimental-strip-types --test tests/civil-input-snapshot.test.mjs` — **6/6 PASS**; TypeScript 5.8.3 standalone strict check of the changed file — **PASS** with test-only type-compatible `civil-time.ts` declarations. The source and test Git object hashes were matched against the created PR files. **Not executed:** full repository `npm test`, full TypeScript/Angular production build, Rust/Tauri IPC, Windows WebView2, real sky computation or cross-platform pinned timezone validation. No account data, network, storage, installer, new dependency, GitHub Actions or main merge.
