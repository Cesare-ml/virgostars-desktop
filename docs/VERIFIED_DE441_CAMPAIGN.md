# D-09 — Verified DE441 multi-site / multi-epoch campaign

**Status:** experimental, locally tested orchestration and CLI. **NOT** a scientifically validated ephemeris, certified JPL reference, or production chart-ready engine.

## Scope

This feature composes the **existing** D-06 combined evidence and numerical audit (draft #59, hardened in #65), rather than introducing a third astronomical comparator. It runs that review sequentially on a bounded multi-case matrix. D-06 already verifies the preserved source response, query, independent normalizer code and reference JSON, fingerprints the experimental sky twice, compares all ten geometric bodies, and checks evidence again.

The new campaign additionally:
- requires 4–24 cases with the **same two WGS84 observer sites repeated on at least two UTC calendar dates** (a crossed 2×2 coverage matrix);
- binds each case's manifest UTC, latitude, longitude and height to the actual experimental sky JSON **before** the audit, then checks that sky's SHA-256 and metadata **after** D-06 finishes;
- forbids reuse of actual-sky, normalized-reference, raw-response and raw-query filenames across cases, including case-only aliases on Windows; allows a common normalizer source (one audited version across cases);
- refuses malformed UTC, dates outside the current IERS C72 window (1972-01-01 through 2027-06-27), out-of-range WGS84 coordinates or heights, path traversal, Windows reserved basenames, duplicate case IDs, unbounded user-declared tolerances and unexpected metadata;
- reports only aggregate blocked/outside/checked counts; it fails the **entire** campaign if any case fails or reports science as validated.

D-06's per-case comparisons use the **existing** spherical angular separation (not the older per-coordinate comparison from draft #57), ppm distance and TT/TDB epoch comparisons. The no-actual-science, no-production-activation limitations of D-04/D-06 still apply.

## Local manifest example

Keep the manifest and all referenced files in a private, operator-controlled folder outside Git. A fictional JSON manifest with **no astronomical data** is shown below. The five fields ending in File are relative filenames in that folder, never paths:

    {
      "schemaVersion": 1,
      "tolerances": {
        "maxDirectionArcsec": 1,
        "maxDistancePpm": 10,
        "maxEpochSeconds": 0.1
      },
      "cases": [
        {"id":"winter-north","utcIso":"2026-01-15T12:00:00.000Z","latMicro":45000000,"lngMicro":12000000,"heightMeters":120,"actualFile":"actual-0.json","referenceFile":"reference-0.json","rawSourceFile":"raw-0.txt","rawQueryFile":"query-0.txt","normalizerFile":"normalize.py"},
        {"id":"winter-south","utcIso":"2026-01-15T12:00:00.000Z","latMicro":-34000000,"lngMicro":151000000,"heightMeters":10,"actualFile":"actual-1.json","referenceFile":"reference-1.json","rawSourceFile":"raw-1.txt","rawQueryFile":"query-1.txt","normalizerFile":"normalize.py"},
        {"id":"summer-north","utcIso":"2026-07-15T12:00:00.000Z","latMicro":45000000,"lngMicro":12000000,"heightMeters":120,"actualFile":"actual-2.json","referenceFile":"reference-2.json","rawSourceFile":"raw-2.txt","rawQueryFile":"query-2.txt","normalizerFile":"normalize.py"},
        {"id":"summer-south","utcIso":"2026-07-15T12:00:00.000Z","latMicro":-34000000,"lngMicro":151000000,"heightMeters":10,"actualFile":"actual-3.json","referenceFile":"reference-3.json","rawSourceFile":"raw-3.txt","rawQueryFile":"query-3.txt","normalizerFile":"normalize.py"}
      ]
    }

Tolerances are **reviewer-supplied provisional thresholds**, not an accepted scientific error budget. They must be finite, positive, and at most 3600 arcseconds, 1,000,000 ppm and 1 second, matching the existing D-04 parser upper bounds. A matching synthetic or self-copied result is **not independent scientific evidence**.

Each actual JSON must satisfy the existing ExperimentalSkySnapshotV1 contract. Each normalized reference JSON must use the existing D-04 reference schema and claim hashes of an independently preserved raw Horizons response, raw query and separate normalizer. D-05 verifies their bytes against these claims; it does NOT prove the claimed external source's authenticity.

## Run manually

Using Node.js 22+ from the VirgoStars Desktop root:

    node scripts/ephemeris/run-verified-de441-campaign.mjs path/to/campaign.json

The manifest is capped at 64 KiB; each actual sky is read with a 128 KiB cap. D-06 retains the existing per-file caps for evidence and reference data. Inputs are read-only regular files; symlinks, named pipes and directories are refused by the campaign reader, with non-follow/nonblocking flags on supporting operating systems and pre/post opened-file metadata checks. UTF-8 is decoded strictly. Files are processed sequentially, not in parallel; no network, background work or clock-triggered integration is initiated.

Exit/status:
- Exit **0**: VERIFIED_DE441_CAMPAIGN:PROVISIONAL_ALL_WITHIN checked=N. **Experimental only**, not independently certified.
- Exit **1**: VERIFIED_DE441_CAMPAIGN:FAILED checked=N blocked=B outside=O. A numerical mismatch or blocked case makes the whole campaign fail.
- Exit **2**: VERIFIED_DE441_CAMPAIGN:INVALID_CAMPAIGN, INVALID_LOCAL_FILE or ARGUMENTS_REQUIRED.

No raw positions, dates, observer coordinates, file paths or source text are printed. Filesystem protections remain best effort against malicious replace-and-restore races and OS-specific handling of NOFOLLOW/NONBLOCK. Unique filenames do not in themselves prevent hard-link reuse, and matching file hashes do not authenticate JPL/NAIF.

## Test status

**Actually executed locally (Node 22.16.0):**

    node --test tests/verified-de441-campaign.test.mjs tests/verified-de441-campaign-cli.test.mjs
    # 25/25 PASS; 18 pure orchestration tests + 7 local-process CLI tests
    node --check scripts/ephemeris/verified-de441-campaign.mjs
    node --check scripts/ephemeris/run-verified-de441-campaign.mjs
    # both PASS

The 18 core tests exercised the exact campaign implementation with injected synthetic D-06 results and sky metadata. The 7 CLI process tests used **the actual campaign CLI and local filesystem**, with a deliberately **test-only, uncommitted mock of D-06** in the local mirror because the local checkout did not contain all of the upstream modules. Thus the genuine D-04/D-05/D-06 full-chain 4-case run has NOT been executed in this environment. On a full repository checkout the committed CLI and test files import the real D-06.

The synthetic files and mock normalizer have *fabricated* observations. Successful tests do not prove numerical accuracy, scientific independence, provenance rights, source authenticity or native readiness.

### Still required before claiming astronomical correctness

1. Re-run all D-04/D-05/D-06, D-08 and D-09 Node suites together on the current stacked branch with the **real** D-06 and no injected mocks, including the CLI 4-case tests.
2. Compile the real VirgoStars-Ephemeris Rust DE441 bridge with Cargo 1.90+ and an authorized classic DE441 kernel; validate origin and file integrity, not just a supplied hash.
3. Obtain genuine independently generated JPL Horizons/NAIF responses, query parameters, reduction source and authentic fingerprints, and perform a reviewed physical-frame/time-scale/body-center comparison across multiple dates and sites. Numeric/geometric agreement is still not a certificate of apparent-chart readiness.
4. Reconcile duplicate experimental review scripts in the older draft #57 with this canonical D-06-based campaign; do not merge two alternative comparators as two independent accuracy proofs. Preserve D-03 readiness quarantine in #51 until a separate reviewed scientific contract is approved.
5. Perform Windows native Tauri/WebView2 and full desktop build tests separately.

**Git integration:** stacked on draft #65 → #59 → #58 → #55 → #48 → #47. No GitHub Actions, merge to main, deploy, release, public visibility, license, privileged backend, user account or production-data changes.
