# D-15 — Manual Horizons regression gate (offline)

**Status: locally tested manual operator tool.** This is a test runner, not an astronomical accuracy certificate. It does not access NASA/JPL, start the desktop, enable chart-ready data or make GitHub Actions.

## Why

The JPL/Horizons request planner, downloader, original-response bundle verifier, safe rollback helper and strict header parser were developed as adjacent pieces. A test suite that runs only the available files on a partial checkout can misleadingly look green even if the downloader, plan or verifier were never exercised.

The new entrypoint `scripts/ephemeris/run-horizons-regressions.mjs` uses an **explicit closed list** of tests and exact expected counts. It refuses missing, symlinked, zero-byte or excessively large test files and fails closed if Node's TAP report is missing, truncated, inconsistent or reports any failing, skipped, cancelled or TODO cases. It executes exactly the six selected test files without arbitrary path arguments. Its output consists of fixed status codes and a passing test count; no response bodies, private epochs or local file paths are printed.

## Commands (Node.js 22+)

Use a **complete repository checkout**, including the draft PR branch:

```powershell
node scripts/ephemeris/run-horizons-regressions.mjs --suite core
node scripts/ephemeris/run-horizons-regressions.mjs --suite all
```

- `--suite core`: 29 tests: conservative rollback (14), strict pre-ephemeris headers (15).
- `--suite all`: **84 tests**: reviewed query plan (10), mocked acquisition (21), offline ten-response audit (15), rollback (14), strict header reader (15), descriptor-owned writes (9).

The count is pinned deliberately. Any added or removed tests must trigger a review and update of this contract. Never lower the expected count to mask failing, skipped or unavailable tests.

Terminal statuses: `HORIZONS_REGRESSION:PASS` (exit 0), `FAILED` (exit 1), `INCOMPLETE` / `INVALID_ARGS` (exit 2), `INTERNAL_ERROR` (exit 3). Failure status is intentionally sanitized. For investigation, manually run an individual synthetic-only test file using Node's native `--test` command in a trusted private checkout; do not copy user records into fixtures or public issue comments.

The runner protects against a nested Node test context by excluding `NODE_TEST_CONTEXT` only from its test child process. Both the runner and the real tests are still executed by the locally installed Node binary. Test output is bounded to 8 MiB and the child has a 120-second limit. No network access is initiated by the runner; the acquisition tests use a mock fetch transport.

## Actual validation

Node.js v22.16.0, isolated local mirror containing the exact two new standalone modules:

```text
node --test tests/strict-horizons-headers.test.mjs tests/rollback-horizons-directory.test.mjs tests/run-horizons-regressions.test.mjs
# 42/42 PASS

node scripts/ephemeris/run-horizons-regressions.mjs --suite core
# HORIZONS_REGRESSION:PASS
# HORIZONS_TEST_COUNT:29

node scripts/ephemeris/run-horizons-regressions.mjs --suite all
# HORIZONS_REGRESSION:INCOMPLETE
# exit 2 — intentional: three additional suites are absent in this isolated mirror
```

The new runner has 13 tests for strict options, exact TAP summaries, zero skips, missing/symlinked/oversized files, subprocess failures, nested Node test context and actual operator CLI behavior.

Locally executed source and test byte content exactly matches GitHub blob hashes:
- `scripts/ephemeris/run-horizons-regressions.mjs`: `4e0b47fe0825da6167d66d75f36d8d7f6257cde5`
- `tests/run-horizons-regressions.test.mjs`: `d928e01bb2f7392b3d6c00f5b9feffc3a7af26c2`

**Not executed:** the complete 84-case suite on a full clone, any real Horizons request, real JPL data, scientific DE441 comparison, Cargo/Rust, Angular/npm, Windows Tauri/WebView2 or releases. A green 84-case result in future would verify these particular simulated integration and security tests only, not source authenticity or astronomical precision.

No GitHub Actions, deploy, main merge or production change.

## D-16 follow-up — verified descriptor-owned writes

The all-suite now also includes `tests/owned-horizons-writes.test.mjs` (9 real-file tests), increasing the required complete total from 75 to **84**. The isolated local mirror ran **51/51 PASS** (14 rollback + 15 header + 13 manual-runner + 9 owned-file tests). The manual `--suite core` still requires 29 PASS; `--suite all` reports **INCOMPLETE**, because the three acquisition/reference suites are not present in this local mirror. Do not describe the complete 84 tests as executed.

## D-17 — Full-suite count updated to 86

The descriptor-owned-file test module now contains **11** tests rather than 9: two new canonical-name and foreign-filename rejection cases. The `all` regression gate therefore requires **86 passes**, with zero failures/skips/cancellations. The `core` suite remains 29. Only **53** locally available tests were executed together on Node.js 22.16.0; the `all` gate still correctly returns `INCOMPLETE` in this isolated checkout and must be run on a complete authorized checkout before merge.


## D-18 — API transport-version tests added to the full gate

The exact all-suite now includes `tests/probe-horizons-wire-version.test.mjs` with **13 new mocked transport/CLI cases**, bringing the required all-suite total from 86 to **99**. The core suite remains 29. An isolated checkout actually ran **66/66 PASS** (14 rollback, 11 owned-writes, 15 strict headers, 13 manual regression-runner and 13 wire-version probe tests). The complete 99 tests have NOT been run in this environment; `--suite all` still reports `INCOMPLETE` until the full original-response acquisition and offline-bundle suites can execute. See [HORIZONS_WIRE_VERSION_REVIEW.md](HORIZONS_WIRE_VERSION_REVIEW.md).


## D-19 — 115-case complete gate with offline 1.2 sample review

Add `tests/review-horizons-wire-sample.test.mjs` (16 test cases) to the previously required 99 tests. The `all` gate now requires exactly **115/115**, zero skips/failures/cancellations, across eight explicitly named test files. The `core` gate remains exactly 29. In the isolated local environment the available test files together passed **82/82**, while `--suite all` still returned `INCOMPLETE` (exit 2). Do not report the 115-case suite as executed. The new reviewer never contacts the network, changes astronomy code, or enables the client.
