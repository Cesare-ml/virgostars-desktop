# Civil birth-time to calculation request hand-off

**Status:** pure TypeScript prototype and local contract tests. No active natal input form, real sky computation, Tauri IPC, astronomical kernel, persistence or production effect.

## Motivation

Draft #52 resolves a civil date/time and IANA zone into zero, one or two UTC instants; draft #56 requires the user to choose explicitly between DST fold candidates. Draft #47 implements a bounded latest-only Rust calculation queue but lives on an independent branch. A future UI must not bypass the time-choice guard or send uncontrolled birth input straight to the calculation port.

## Code

`src/app/native/civil-calculation-dispatch.ts` exports `submitCivilCalculation`, an isolated dependency-injected hand-off with a **structurally matching** subset of draft #47's `CalculationDraftV1` contract:

- Input: civil date/time/IANA zone; injected selector backed by `selectCivilInstant(input, resolveCivilTime, selectedUtc)`; WGS84 integer latitude/longitude in microdegrees; an **already generated, opaque** calculation key; and an injected queue implementing `submit(draft): number | null`.
- Reject invalid/out-of-range coordinates and malformed calculation keys before civil-time resolution or queue access.
- The selector runs on every attempt, so a DST fold remains `choice_required` until one exact UTC candidate is provided. A skipped hour, invalid civil input or stale UTC choice never reaches the queue.
- For a selected instant, send **only** `{intent:'committed', utcIso, latMicro, lngMicro, timeZone, calculationKey}`. The `selection` returned alongside the queue sequence retains the original civil input, historical offset in seconds and explicit `host_iana_unpinned` provenance. The helper does not log the values.
- Queue refusal, invalid sequence or thrown exception becomes a sanitized `queue_unavailable`, **never** a ready sky result. This module does not inspect any numeric ephemeris payload.

The selector and queue are injected because #47 and #56 are separate draft branches. **This PR does not copy their code or import unavailable files**. After the prerequisite branches have been merged and checked together, wire the real `LatestCalculationQueue`, add the Angular birth-time form/choice prompt and a secure native adapter separately.

## Calculation-key and scientific warnings

The caller must generate a **session-scoped opaque fingerprint** from *all* inputs that affect the eventual calculation, including the selected UTC candidate, coordinates, house settings, provider/model version and any other relevant configuration. Validating the key's syntax does **not** prove that it covers the inputs or protects low-entropy birth data against guessing. This PR intentionally does not invent a hash scheme or embed personal birth inputs in a key. A future implementation needs a separately reviewed identity/fingerprint design.

The resolver uses host IANA/ICU time-zone data without a pinned tzdb version. Rust must independently validate dates, time scales, precision, and kernel provenance; the experimental DE441 support window is much narrower than 1900–2100. Draft #51 quarantines unverified numerical snapshots, and this bridge must not bypass that gate. No fake sky fallback.

## Actual checks

On Node.js 22.16.0:
- `node --experimental-strip-types --test tests/civil-calculation-dispatch.test.mjs tests/civil-time-choice.test.mjs`: **23/23 PASS**.
- TypeScript 5.8.3 `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/native/civil-time.ts src/app/native/civil-time-choice.ts src/app/native/civil-calculation-dispatch.ts`: **PASS**.

The new 12-test suite uses fictional dates/locations and a mock queue port. It validates DST folds/gaps, stale choices, mismatched coordinates, invalid keys, offsets, sanitized queue failures and exact draft-field projection. An actual latest-only queue integration test must run **after** draft #47 is available in the combined branch.

Not executed: full `npm test`, Angular `build:ui`, actual #47 queue/native Rust/Tauri IPC, Windows WebView2, independent JPL comparison, kernel checks or deployment.

No extra npm dependencies, user accounts, keys, storage, network requests, GitHub Actions, new releases, visibility changes or main-branch merge.
