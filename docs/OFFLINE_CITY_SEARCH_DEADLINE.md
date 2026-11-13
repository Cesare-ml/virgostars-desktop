# Offline city-search IPC deadline

**Status:** TypeScript prototype, stacked on error-boundary draft PR #157. It does not modify the Rust sqlite search, real catalogs, astronomy or network operations.

## Behavior

An unresponsive Tauri `search_offline_places` invocation previously left the city-picker in `loading` without a bound on when a reply might arrive. The Angular-side `OfflinePlaceSearch` now wraps the existing read-only IPC call with a fixed **5-second deadline**. On timeout, the search safely returns the existing `unavailable` state. A late native reply cannot make that timed-out request successful or overwrite a newer request. There are no retries, polling or data uploads.

The deadline is armed before the IPC invocation begins; broken schedulers, absent timer handles and synchronously expired deadlines fail closed without invoking native search. A rejected timer promise has a defensive observer if a faulty scheduler fires and then throws. Timers are cleared after settled successful or failed requests, and timer-cleanup exceptions cannot alter their result.

**Important:** this is a client-side UI timeout, **not a native cancellation**. The original Tauri request can remain in-flight after the timeout; the Rust concurrency limit is unchanged. A future native cancellation contract needs separate review.

## Verification

Executed in an isolated local source copy with Node.js 22.16.0 and TypeScript 5.8.3:
- `node --experimental-strip-types --test tests/offline-place-error-boundary.test.mjs tests/offline-place-deadline.test.mjs` — **14/14 passed** (9 new deadline tests plus 5 preceding error-boundary tests).
- `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/native/offline-places-contract.ts` — **passed**.

Still required before merging: full `npm test`, Angular production build, actual Tauri IPC and Windows/WebView2 smoke. There are no new npm dependencies, privileged permissions, real personal data, account storage, license/NOTICE changes, releases or GitHub Actions.
