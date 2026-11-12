# D-06 — Combined DE441 evidence and numerical comparison gate

**Status:** local orchestration unit tests passed with deliberately isolated dependency stubs. This is **not** independent astronomical validation, an active Rust provider, or a Windows-tested build.

## Purpose

Draft #58 adds a manual numerical comparison against an independently normalized reference. Draft #59 adds a separate manual check of the saved JPL Horizons response, the saved query and the saved normalizer source against their declared SHA-256 hashes.

Running the numeric comparison *without* first running the evidence check would leave a gap. This additive, explicit-only command makes the three checks part of **one invocation**:

1. Validate the evidence bundle (raw response, original query, normalizer source and normalized JSON).
2. Compare the experimental ten-body sky to the normalized reference, with user-declared bounds.
3. Verify the same evidence bundle again, refusing a result if the files appear to have changed.

The command refuses missing evidence, unrecognized statuses, unverified or falsely "validated" results, invalid numeric maxima, incorrect body counts and exceptions. Both modules still exist as standalone review utilities, but this is the **preferred manual entrypoint** for combined audits. It does **not** change chart rendering, Rust IPC, local storage or the ephemeris kernel.

## Manual usage

On Node.js 22 or newer, prepare separately reviewed evidence files on a local computer. These example tolerances are **illustrative only, not certified astronomical limits**:

```powershell
node scripts/ephemeris/run-verified-de441-audit.mjs --actual .local/review/experimental-sky.json --reference .local/review/normalized-reference.json --raw-source .local/review/horizons-original.txt --raw-query .local/review/horizons-query.txt --normalizer-source .local/review/independent-normalizer.py --max-direction-arcsec 1 --max-distance-ppm 10 --max-epoch-seconds 0.1
```

For input schemas, hashes, numeric frames and units, consult [D-04](INDEPENDENT_DE441_REFERENCE_COMPARISON.md) and [D-05](DE441_REFERENCE_EVIDENCE_GATE.md).

### Results

- `REVIEW_WITHIN_TOLERANCE_EXPERIMENTAL`: both evidence checks passed and the independently normalized numbers agree within the user-declared tolerances. Exit code zero. **Does not mean independently certified, chart-ready astronomy.**
- `REVIEW_OUTSIDE_TOLERANCE_EXPERIMENTAL`: evidence checked, but at least one numerical discrepancy exceeded the configured tolerance. Exit code one.
- `REVIEW_BLOCKED`: evidence failed, comparison was invalid/incomparable, evidence changed on a subsequent check, arguments were invalid, or an exception occurred. Exit code one.

All results maintain `scientificallyValidated: false`. Only maximum angular/distance/epoch discrepancies or fixed error/status codes appear on stdout/stderr. Paths, original input text, UTC timestamps, and birth coordinates are not printed.

## Concurrency and trust caveat

The combined command **re-reads** files at multiple stages; it does **not** hold one atomic set of file descriptors for the whole audit. The second evidence verification narrows accidental change windows but cannot prevent deliberate races or prove that a file stayed constant at every intermediate instant. Do not use the result as an input to automatic chart-ready promotion. A future security review should refactor the two validators to accept immutable opened-handle snapshots, or use a reviewed locked/reproducible evidence bundle.

Neither a matching SHA-256 nor a normalized reference assertion of `JPL_HORIZONS` proves source authenticity or scientific independence. The operator still must authenticate the original source and query, review the normalization algorithms and physical frame/correction choices, and compare against independently traceable references. D-03's experimental-result quarantine in PR #51 remains mandatory.

## Local tests actually performed

Node.js 22.16.0:

```text
node --test tests/run-verified-de441-audit.test.mjs
# 14 passed, 0 failed
node --check scripts/ephemeris/run-verified-de441-audit.mjs
# PASS
```

The **14 orchestration tests** used local stubs with the same exported parser/function signatures as the D-04 and D-05 modules. They tested argument validation, mandatory ordering, early failure, cancellation of malformed results, second-pass evidence failure, reported metric constraints and sanitized errors. **They did not execute the actual D-04/D-05 file-reading code end to end**; re-run in a complete checkout, followed by actual file IO test fixtures and Windows validation.

Executed local Git blob hashes for new files:

- `scripts/ephemeris/run-verified-de441-audit.mjs`: `61d63deab9271114320a06109ca966d5d77ca38e`.
- `tests/run-verified-de441-audit.test.mjs`: `6b8950f6c6485b2d3cd39ef0bbd27ce58ea533d5`.

**Not run:** full `npm test`, Angular build, native Rust/Cargo, authentic DE441/Horizons comparison, WebView2, Windows installer. No automatic GitHub Actions, merge, deployment, release, publication or production changes.

**PR dependency:** #59 stacked on #58 → #55 → #48 → #47; draft remains review-only.

## D-07 — Real module integration and normalized-reference change detection

The combined audit was run end-to-end with **the actual D-04 numerical comparator, D-05 evidence file reader, and D-06 orchestrator**, using exclusively temporary **fictional** files and real Node.js subprocess CLI calls. These tests do not authenticate JPL/Horizons and do not involve real DE441 astronomical data.

A regression discovered in D-06 permitted an edited normalized-reference JSON to pass the final evidence check when its three self-declared raw/query/normalizer digests remained unchanged. D-05 now returns its **local, not printed** `referenceSha256` fingerprint; D-06 requires the first and second fingerprints to match. A changed normalized reference returns `REVIEW_BLOCKED` / `EVIDENCE_CHANGED` even if all other source digests still match. **This narrows an integrity gap; it does not eliminate file-handle races or independently authenticate the reference.**

### Actual execution

Node.js **22.16.0**, isolated mirror of exact GitHub source modules:

```text
node --test tests/verify-reference-evidence.test.mjs tests/run-verified-de441-audit.test.mjs tests/verified-de441-audit-integration.test.mjs
# 43 tests, 43 passed, 0 failed (14 evidence, 14 orchestrator, 15 true-module integration)
```

`node --check` of all three imported modules passed. New/edited source and test Git blob IDs were checked against local executed files before commit and GitHub readback afterward. The main comparison source was unmodified, matching SHA `4964b534085894b5ed448bf67bedae5b287a32b7`.

**Not executed:** whole application `npm test`, Angular production build, Rust/Cargo/Tauri, real DE441 kernel, authentic JPL Horizons data, Windows WebView2, external scientific error-budget approval. No user records, secrets, GitHub Actions, release, merge or production activation.

## D-08 — Experimental sky input fingerprint before and after the numeric comparison

D-07 bound the normalized reference JSON between both evidence checks. A second integrity gap remained: an experimental **actual** sky JSON could change after the numeric comparator had read it. The combined audit now fingerprints the experimental file using the same read-only, symlink-resistant, bounded file inspection used by D-05. It requires matching 64-character lowercase SHA-256 fingerprints **before and after** the numerical calculation. Missing, unsafe or unreadable actual files return \`SNAPSHOT_UNAVAILABLE\`; changed bytes return \`SNAPSHOT_CHANGED\`. These fingerprints are internal to the review and never printed.

The enforced order is **reference evidence → experimental snapshot fingerprint → numeric comparison → experimental snapshot fingerprint → reference evidence**. Neither actual nor reference may be silently modified during the normal audit window. Two separate opens are **not atomic** and do not eliminate an adversarial replace-and-restore race. Genuine scientific accuracy, kernel provenance and source independence remain unvalidated.

### Executed local regression

**Node.js 22.16.0:** \`node --test tests/verify-reference-evidence.test.mjs tests/run-verified-de441-audit.test.mjs tests/verified-de441-audit-integration.test.mjs\` yielded **52/52 passing** (17 coordinator, 17 evidence, 18 real-module integration) using fictional files, including a deliberately edited actual sky JSON after successful numerical comparison; the combined gate now rejects it. The prior 43 tests also remain covered. Source passed \`node --check\`. Source, test and documentation files were compared with exact Git blob hashes after GitHub push.

The complete project, real JPL Horizons parity, actual DE441 binary, Rust/Cargo integration, Angular build and Windows/WebView2 were **not tested**. No release, main merge, production change or GitHub Actions was performed.
