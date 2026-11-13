# Latest-only civil calculation replacement (synthetic integration)

**Status: locally tested prototype, not wired to the Angular natal editor or real astronomical results.** This draft is stacked on the civil-input integration PR #174 and exercises the existing `LatestCalculationQueue` source from `main`, without changing its scheduling internals.

## Why this matters

`submitCivilCalculation()` checks one request and refuses malformed input. That is correct for a stateless submission, but **does not retire an already running request**. If a user edits a valid birth time into a DST gap, missing date, invalid coordinate or ambiguous fold, the *old* request might still return a response later. The UI must not show stale output as belonging to the newly edited birth details.

## New additive API

`replaceCivilCalculation(input, selectInstant, location, calculationKey, queue, selectedUtc?)` accepts a `ReplaceableCivilCalculationQueue` with `invalidate(): void` and `submit(draft): number | null`.

1. Invalidate the prior queue generation **before reading or resolving the new civil input**.
2. Run the existing `submitCivilCalculation()` validation, timezone resolver, explicit fold-choice gate and exact coordinate projection.
3. If the replacement is invalid, skipped or undecided, return its existing sanitized status with **no new queue submission**. The old generation stays invalidated even when the new request cannot be accepted.
4. If valid, submit one strictly projected request to the queue. Exceptions in `invalidate()` become `queue_unavailable`, with no details or subsequent submission exposed.

The old `submitCivilCalculation()` remains unchanged for callers with their own scheduling lifecycle. Call the new replacement function only when the editor's **calculation-relevant input revision changes**, not on every paint/redraw or status refresh.

**Limits:** `AbortSignal` and queue generation checks prevent stale frontend delivery, but cannot stop a non-cooperative native Rust/CPU job. An unresponsive provider can still delay a new request until it settles. The caller must generate a session-scoped, privacy-safe calculation key covering all calculation-affecting inputs. The tests' fixed synthetic keys are **not** suitable for real personal data. No one may interpret a `submitted` status as a finished or accurate sky chart.

## Executed checks (2026-11-14)

Using Node.js **22.16.0** and TypeScript **5.8.3**, in an isolated mirror of the **exact** combined PR #174 civil sources plus the real `LatestCalculationQueue` from `main`:

```sh
node --experimental-strip-types --test tests/*.test.mjs
# 48/48 passed: 41 civil baseline/integration + 7 new queue-lifecycle tests

tsc --noEmit --strict --target ES2022 --module ESNext \
  --moduleResolution bundler --lib ES2022,DOM \
  src/app/native/civil-time.ts \
  src/app/native/civil-time-choice.ts \
  src/app/native/civil-calculation-dispatch.ts \
  src/app/native/calculation-queue.ts
# passed
```

New tests `tests/civil-latest-queue-replacement.test.mjs` cover normal unavailable-only submission, a skipped DST time invalidating an in-flight request, explicit autumn-fold selection superseding prior work, invalid coordinate revisions, 30 rapid same-turn updates coalescing, broken invalidation and disposal.

Exact tested Git blobs:
- Existing queue from `main`: `8bbfebd4e17ce7d91dfcae35b428e9df028c4369`.
- Updated civil dispatcher: `e641c3a6acf6ad8ae0875d3f3e13ccb37bba62e0`.
- New seven-case test: `795c1338cbe01e555a7f1f07148a075818e54931`.

These checks do **not** cover the full Desktop repository test set, Angular template compilation, Windows Tauri/WebView2, actual protected city data, Rust ephemeris kernels, scientific accuracy, or authenticated/offline account persistence.

## Integration and privacy boundaries

Before merging, review this PR with #174, the separate native draft-snapshot PR #142 and the existing natal candidate/HMAC queue drafts (#94/#100/#106). Reconcile a **single** user-facing natal editor and choose a single supported calculation queue path. Run a complete authorized source checkout `npm test`, `npm run build:ui`, native Rust tests and Windows GUI/offline checks. A trustworthy provider must enforce the precision/range/schema gates, and synthetic `unavailable` cannot become a chart.

No GitHub Actions, accounts, tokens, private birth records, network calls, production services, database changes, new dependencies, license changes, publication, release or merge to `main`.
