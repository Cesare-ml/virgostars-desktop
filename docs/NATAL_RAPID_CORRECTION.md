# Natal chart rapid civil-time correction — preview-only v1

**Status (2026-11-12):** source and Angular form controls authored in PR #30. Pure TypeScript module \`natal-time-step.ts\` tested in an isolated local Node 22 / TypeScript 5.8 checkout; **native Tauri/Angular full build and real ephemeris drawing are NOT validated**.

## User operation

The experimental **Nuovo tema / New natal chart** form now shows five compact pairs of +/- controls for **year, month, day, hour, minute**. A pointer/touch press moves **one step immediately**, followed by a **340 ms initial delay** and then **75 ms steps**, shortening to **45 ms** after sustained use. Quick clicks advance one step. Keyboard and assistive-tech clicks can use buttons via native \`click\`, with clear aria-labels. Press/release, pointer cancellation, lost pointer capture, switching inspector tabs / component destruction, and window blur cancel the repeat timer.

The form is still **guest-only, unsaved, synthetic-chart separate**; changing these values **does not yet trigger astronomical IPC**. A separate [latest-only calculation scheduler](LATEST_CALCULATION_SCHEDULER.md) now exists and passed 10/10 mock tests with 10,000 submissions, but it remains intentionally **unconnected to the editor** until real offline Rust ephemerides are numerically validated. The source is an in-memory UI interaction foundation that can later issue latest-only calculations through the already specified bounded Rust bridge. Do not imply live chart animation is implemented.

## Calendar semantics

- Calendar type: **Gregorian AD year 1–9999** only; do not claim BCE or historical local calendar cutover.
- **Year and month correction:** move one calendar field; clamp date if the old day is invalid in the new month/year (31 Jan +1 month → 28/29 Feb, 29 Feb 2024 +1 year → 28 Feb 2025).
- **Day correction:** roll over Gregorian month/year boundaries.
- **Hour/minute correction:** roll over adjacent days/months/years, retaining the *entered local wall-clock fields*. This is deliberately NOT an elapsed real-time / UTC timeline increment across DST gaps/folds.
- **Unknown birth time:** hour/minute controls are disabled; date changes retain the original hour/minute strings (normally empty), **never fill them with 00:00 or 12:00**.
- Partial or invalid input: return no correction rather than inventing date defaults. Range bounds (year 1, year 9999) fail closed without wrap.
- Every successful step changes all five civil fields in **one state update**, invalidates the old natal preview and any previously selected/ambiguous UTC candidate. The user must explicitly re-check the bundled IANA timezone preview after correction.
- Absolute UTC corrections, house recalculation and live chart frames are intentionally deferred to the *real* Rust ephemeris and historical tzdb implementation. A calendar change across DST can produce an impossible or ambiguous wall time, which the preview detects on the next validation.

## Bounded resource model

\`src/app/natal-time-step.ts\` is a pure Gregorian wall-time unit step plus \`CorrectionHold\` with exactly **one pending timeout** per active control. New starts cancel prior timers; a failed/boundary step stops repeating. No WebGL, network, large arrays, cache, database or native IPC operations occur on the hold path.

\`NatalDraftState.applyCivilCorrection\` commits a validated output atomically, avoiding partial intermediate datetime states. \`NatalDraftComponent\` marks Angular change detection explicitly for timer callbacks (the app uses zoneless Angular), and invalidates prior timezone preview on every valid step.

Design performance gate before **real chart animation**:
- The UI may update up to `22 local state steps/sec during a sustained hold, but this rate **must not** dictate ephemeris calculation throughput.
- Use latest-only/coalesced Rust worker IPC, finite queue and stable incremental Three.js scene; never make an unbounded calculation request per timer callback.
- Measure p50/p95 click-to-frame latency and memory on normal Windows hardware over 60+ seconds, including direction reversal, DST transitions and closing the panel mid-hold.
- User selected natal chart edits must remain **preview-only** until explicit Save; never overwrite saved birth data on every increment.

## Tests

The new \`tests/natal-time-step.test.mjs\` authors **15** Node tests (leap days, year 1/9999, month clamping, local midnight, unknown time, invalid input, hold timer lifecycle, direction reversal, 10,000-event bounded stress, and Angular cancellation source wiring).

**Actually executed in an isolated local Node.js v22.16.0 environment:** **10/10 targeted smoke tests passed** (including 10,000 fake-timer callbacks), and TypeScript 5.8.3 \`tsc --noEmit --strict\` passed on the exact same new \`natal-time-step.ts\` GitHub blob, SHA \`7d100bdb118106f05db70200d2f6b9de4b1e1fca\`. The full committed 15-test suite, Angular production build, Tauri native test and screenshot have **not** yet been run.

Local Windows commands to execute after safely checking out the PR branch:

```powershell
npm.cmd test
npm.cmd run build:ui
cd src-tauri
cargo test
```

The existing SQLCipher/ACK/storage work is proceeding independently in draft PRs #31–#35; **do not create a second personal-data store**, connect unreviewed storage or enable Save here. The in-memory natal draft remains usable without login.

## Integration to-do

- [x] Five date/time +/- UI pairs with pointer hold + keyboard clicks, i18n and compact layout authored.
- [x] Calendar math and one-timer hold isolated, tested with exact committed module.
- [x] Unknown-time and DOB boundary behavior, timezone preview invalidation, pointer release/blur cleanup implemented.
- [ ] Run full Angular app build, Node suite, native Windows WebView2 input/keyboard/touch acceptance.
- [ ] Reconcile approved local guest SQLCipher storage PR chain; OS-managed encryption key, real save/open, migration/backup and permissions.
- [ ] Integrate Rust-only offline astronomical calculation + validated tzdb and low-latency latest-only render so hold controls animate **actual** natal/transit charts.
- [ ] Manual review/merge of stacked draft PRs after validation and maintainer approval.

**No private birth data, purchased city records, release assets or secrets were committed.**
