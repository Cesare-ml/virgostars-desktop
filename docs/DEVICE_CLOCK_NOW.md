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

After the Rust VirgoStars-Ephemeris provider is validated and exposed via a **separate, versioned, bounded native bridge**, add a user-selectable offline city/timezone and UTC instant calculation request. Use actual IANA historical timezone rules for place-local time and a monotonic latest-only request ID for new chart calculations. Never silently substitute device timezone for the selected city or imply that synthetic coordinates are calculated.

## Integration

This change is stacked on draft PR #45 (device-only UI preferences), not yet on `main`. UI PR #7 and the AI inspector PR #23 may conflict on the desktop shell; reconcile in review. No GitHub Actions, merge, release, license/publication change or backend deployment.
