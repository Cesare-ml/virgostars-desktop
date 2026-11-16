# Device-local “Now” clock — first offline Adesso slice

**Status: Prototype / Node-tested helper / Windows UI not yet verified.**

The desktop chart header displays the **device's** current civil date, time, and timezone abbreviation/offset using built-in `Intl.DateTimeFormat`. The text responds to the selected Italian/English locale and has a compact variant for smaller windows.

This is a **time display only**. The rendered natal/transit/synastry charts remain synthetic fixtures. This feature does **not** provide real planetary positions, a native ephemeris, automatic current-sky recalculation, event indexing, a birth timestamp or an astronomical time standard.

## Implementation and reliability

- `src/app/device-clock.ts` implements an injectable timer/clock, re-reads `Date.now()` every tick and never adds a synthetic fixed number of seconds. It can recover after OS sleep and manual clock changes; timezone and DST formatting use the platform's `Intl` timezone data.
- The Angular shell starts the clock after view initialization and disposes its timer on destroy. The callback schedules UI change detection **without calling** the chart renderer or native IPC.
- A reading that is non-finite or outside JavaScript's `Date` range displays `—` rather than a fabricated time. Failed formatting similarly displays `—`.
- `<time datetime="…">` exposes the underlying UTC instant, while the visible label always describes the **device** timezone, not that of a selected city. Do not use it as the timezone of an offline catalog entry.
- No network, authentication, persistence, permissions, new dependencies, privileged commands, backend changes or personal-data writes occur.

## Selected offline city's current civil time (second slice)

When the user selects a locality in the **Settings / Parametri** offline city search,
the inspector now shows **a second clock** for that city's supplied IANA time zone,
beside the original device-local clock in the chart header. Both format the
**same UTC instant**; the city's clock never changes the selected subject,
birth timestamp, chart positions, chart renderer, or any stored records.

- `selectedCityClockAt` (in `src/app/device-clock.ts`) uses built-in
  `Intl.DateTimeFormat` for civil time and historical daylight-saving transitions.
  It runs only for the currently selected city and does **not** make a new timer.
- The city clock refreshes once per sampled second or after a city/language
  change; it never triggers a chart redraw or native astronomical IPC.
- If the city has a null, invalid, or unsupported `timeZone` entry, the
  inspector shows a translated **time zone unavailable** message. In particular,
  it must **never silently substitute the device's own time zone**.
- The city data are temporary and are not saved, uploaded, or used as
  a user-approved birth place. The app does not implement civil-local date to
  UTC disambiguation for historical gaps/folds; this feature displays only
  the *current* instant in a selected city's zone.
- The local IANA database is supplied by the installed JavaScript/WebView
  runtime and may differ across OS versions. Historical timezone fidelity
  must be independently checked before accepting typed birth dates.

**New local checks:** `node --experimental-strip-types --test
tests/selected-city-clock.test.mjs` — **5/5 passed** on Node 22.16.0;
standalone TypeScript strict check — passed. Winter/summer, the 2026
Rome DST spring-forward and fall-back boundaries, New York offset,
unknown time zones, invalid instants and both languages are covered.
The Angular UI and packaged Windows/WebView2 display are **not yet built or
visually verified**.

## Verification

**Executed locally with Node v22.16.0:**
```text
node --experimental-strip-types --test tests/device-clock.test.mjs
# 6 passed, 0 failed
```
Standalone helper TypeScript strict compilation also passed under TypeScript 5.8.3 with the project's `Locale` type represented by the same `'it'|'en'` union. This is **not** a full Angular build.

**Required before merge:**

1. From the authorized desktop checkout with the compiled Charts sibling, run `npm test` and `npm run build:ui`.
2. Verify the clock in the packaged Windows WebView2 build: correct IT/EN and light/dark appearance, full and compact layouts, 1-second updates, DST/time-zone changes and returning after suspension.
3. Verify no unbounded timer remains after window destruction, no chart redraws or network calls are triggered by ticks, and screen readers are not forced to announce each second.
4. If earlier CSS/WebView2 issues persist, resolve them before attributing visual failures to the clock.

## Next real Adesso milestone

After the Rust VirgoStars-Ephemeris provider is validated and exposed via a **separate, versioned, bounded native bridge**, connect the **already selected** offline city/timezone and UTC instant to a real calculation request. Use actual IANA historical timezone rules for place-local time and a monotonic latest-only request ID for new chart calculations. Never silently substitute device timezone for the selected city or imply that synthetic coordinates are calculated.

## Integration

This change is stacked on draft PR #45 (device-only UI preferences), not yet on `main`. UI PR #7 and the AI inspector PR #23 may conflict on the desktop shell; reconcile in review. No GitHub Actions, merge, release, license/publication change or backend deployment.

## Fail-closed device clock samples (2026-11-13 follow-up)

A transient invalid device-time reading (NaN, Infinity, an out-of-range value, or a throwing `ClockDriver.now()`) **must invalidate the previous displayed instant** rather than leaving a plausible but stale date/time visible. The clock stores `NaN` during an invalid sample, so both device and selected-city formatters show their unavailable state, and the accessible ISO `datetime` is absent. Once the device clock supplies a valid time again, the normal one-second sampler recovers without recalculating any astrological positions.

Repeated invalid samples generate no duplicate UI notification; the change to unavailable and the subsequent recovery each notify once. Errors and paths from the underlying driver are not logged or exposed. Focused Node tests cover valid→invalid→valid and throwing source behavior. Angular build and Windows WebView2 resume-from-sleep/manual-clock-change acceptance are still pending. This is a stacked draft on the existing device/city clock PR, not a production release.

## Safe timer setup and teardown (2026-11-13 follow-up)

An injected timer driver may throw while scheduling or cancelling, return an absent handle, or synchronously dispose the owner while `schedule` is executing. The desktop must **not abort Angular initialization** or leave a misleading clock ticking indefinitely when that happens:

- A failed/absent interval handle is treated as a clock-unavailable condition (`NaN`); the visible value becomes `—` rather than showing an old but plausible live time.
- Repeated failed readings do not generate a notification storm. A later explicit `start` can retry after the timer provider recovers; **there is no hidden automatic retry loop**.
- A schedule result returned after synchronous destruction is cancelled immediately. A cancellation exception during normal destruction is contained so other Angular teardown can proceed.
- Late callbacks after destruction have no effect, regardless of whether the timer driver honored cancellation.

Four added synthetic Node regressions cover scheduling exceptions, empty handles, cancellation exceptions and synchronous dispose-in-schedule. They do not substitute for full Angular/WebView2 testing on Windows. There is no network, persistence, user data, astrological computation or new native capability in this follow-up.

## Reentrant live-clock startup hardening (2026-11-13)

A first wall-time refresh or an injected scheduler can call the UI notification
**synchronously** before the initial interval handle exists. Previously the
notification could call `start()` again and install a second interval, leaving an
uncancelled timer after disposal. `DeviceClock.start()` now guards in-progress
initialization and always clears that guard via `finally`, including failures.
If the notification disposes the clock during its first refresh, no timer is
scheduled. Existing zero-valued handles, invalid-time recovery, retry after
failed scheduling, and late-callback safeguards remain unchanged.

Three additional synthetic tests cover reentry from the first refresh, disposal
during that refresh, and a synchronous scheduler tick. This is a local clock
lifecycle correction only: no real astronomical recomputation, credentials,
network, persistence, Tauri IPC, extra dependencies, or new release capability.
Verify with `node --experimental-strip-types --test tests/device-clock.test.mjs`
and then the normal complete Windows/WebView2 acceptance gates. Do not infer
native UI acceptance from a source-only review.


## Current-moment chart input guard (2026-11-16)

The existing **Now at this place** action now goes through the pure
`resolveNowChart` validator before emitting a calculation request:

- It captures one injectable, exact UTC instant and keeps the entered/selected
  place coordinates unchanged.
- It requires a non-empty timezone that the local `Intl.DateTimeFormat`
  runtime recognizes. An empty zone is no longer silently converted to UTC;
  an unsupported zone is reported in the form.
- It rejects non-finite/out-of-range device-clock instants and invalid
  coordinates before any chart-calculation IPC is called.
- It does not run a birth-time/DST-fold resolver: the instant is already UTC.
  The local date, local clock time and UTC offset are derived from that exact
  same instant with the selected IANA timezone; they never replace or shift
  the UTC value sent to the provider. Winter/summer offsets are therefore
  handled by the device timezone database, without assuming a fixed offset.
- The helper is deterministic under tests because the `Date` is injected.
  No new native command, astronomy implementation, network access or storage
  was introduced.

Focused regression coverage is in
`tests/new-chart-form.test.mjs`. Run it with:

```sh
node --experimental-strip-types --test tests/new-chart-form.test.mjs
```

This is still a calculation request, not proof that the default build has an
ephemeris provider. Without the optional local-use-only Swiss provider, the
existing `provider_unavailable` state remains the expected result. The
Swiss-enabled binary remains restricted to the maintainer's local use because
of its AGPL licensing status; do not distribute it.


## Opt-in live chart tracking (MVP)

The calculated-chart toolbar offers **Track current sky / Segui il cielo attuale** only when a calculated chart is active. It uses the same place coordinates and the device's current UTC instant, recalculating no more than once per clock minute via the existing native provider. Tracking stops when switching away from that chart, removing it, destroying the component, or on a calculation failure. A browser preview or a Tauri build without an astronomical provider reports the existing calculation error; it does **not** silently display synthetic positions as current sky. The existing chart remains visible after a failure. No network, background process, archive write, or new native IPC permission is introduced.

This is opt-in rather than automatic at application startup. Full Angular, Tauri and Windows GUI verification remains required before release.
