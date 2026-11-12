# Natal input form — local UTC preview

Status: **Angular UI prototype, non-scientific**. The form is visible in the right-hand Settings / Parametri inspector, directly below the existing read-only offline city picker. No production birth record storage or real astronomical positions.

## What was implemented

- New standalone Angular component `vs-natal-input` with local birth date (1900–2100 Gregorian), civil time, bilingual Italian/English guidance, selected offline city, explicit two-choice DST ambiguity buttons, live aria status, and computed UTC display.
- Uses the already-implemented `CivilCalculationSession` from draft #61 (itself composed from the actual D-01 latest-only queue + civil-time resolver/explicit choice), not a duplicate or ad-hoc UTC algorithm.
- Its injected calculation port always returns **unavailable** as a correctly correlated response. This keeps the real output quarantined: even if another component accidentally sends ready-shaped data to the session, its existing deny-all snapshot validator prevents a chart-ready success.
- Input edits and place changes immediately invalidate earlier requests, clear DST choices and remove any previously displayed UTC. Selected cities with missing time zone or invalid coordinates cannot produce a request.
- No names, dates or places are saved to disk, local/session storage, network, browser URL or logs. When the Angular component is destroyed, its transient form values and calculation queue are disposed. The current chart on the left remains explicitly synthetic and unchanged.
- The preview-only `ui_preview_N` key is **not** a stable scientific fingerprint. Before enabling any real Rust provider, replace it with a reviewed privacy-safe per-input identity covering all calculation-affecting data. Do not send any real calculation with this preview identifier.
- Uses the already-selected city from the parent inspector; no duplicate city-search UI or private city catalog is added. In the browser (without native city search) it may not be possible to pick a city; this is a known prototype limitation.

## Files

- `src/app/natal-form-state.ts` is a pure TypeScript controller, independently testable and free of Angular imports. It owns only ephemeral date/time/place selection and sanitized result status.
- `src/app/natal-input.component.ts`, `.html`, `.css` contain the compact accessible UI in both light and dark palettes.
- `src/app/natal-input-messages.ts` contains local aligned IT/EN labels so existing shared translation modules and other UI draft branches are untouched.
- Two tiny integration points in `desktop-app.component.ts/html` register and show the component within Settings; these will need conflict review against the separate guest-theme/clock UI drafts #45/#46.

## Actual checks

On Node.js v22.16.0: `node --experimental-strip-types --test tests/natal-form-state.test.mjs` passed **11/11** with synthetic city/time fixtures, including stale selection clearing, invalid zones, cancelled queue outcomes, no persistence, bilingual label parity and static component contract checks.

TypeScript 5.8.3 strict check on the pure form state and messages passed with local **type-only stubs** for the already-existing imported contracts. This is not a substitute for a real Angular build; no Angular compilation or WebView2 GUI smoke was run.

## Open acceptance gates

- Run complete `npm test` and `npm run build:ui` with real Angular 20 and the public Charts package in a checked-out combined branch. Verify component templates, input focus, screen reader announcements and dark-mode CSS on Windows WebView2.
- Review the UX of the 1900–2100 civil-time range versus the much narrower current experimental DE441/IERS support window; the UI must clearly block out-of-range real calculations.
- Integrate a versioned scientifically validated native Rust provider with approved data/kernel and independent JPL/NAIF references. This PR deliberately does not unlock scientific chart rendering.
- Independently review timestamp fingerprinting, historical timezone data provenance and identity/privacy handling before accepting real birth data.

No GitHub Actions, merge to main, release, backend modifications, credentials, personal records, or public visibility changes.
