# DE441 reference campaign — multi-epoch / multi-observer review

**Status:** Node-tested offline orchestration, NOT certified astronomical accuracy. This tool computes no positions, does not authenticate provenance and does not enable real Desktop charts.

## Purpose

The single-case reference comparator in draft #57 checks experimental geometric sky snapshots against externally supplied normalized reference numbers using **provisional** per-field tolerances. This campaign runner requires 4–24 different case records covering a **crossed 2×2 grid**: the same two observer locations on at least two distinct UTC calendar dates. A single failed case makes the entire campaign fail. It uses the existing comparator and performs no new astronomy. Draft #58 implements a different, more comprehensive spherical comparison; #59 separately checks raw Horizons query and normalization evidence. These approaches are complementary review gates, NOT independent scientific validation or additive numerical-confidence scores.

## Manifest contract

Save a local, untracked campaign.json with exactly schemaVersion=1 and cases. Each case has exactly: id, utcIso, latMicro, lngMicro, heightMeters, actualFile, referenceFile.

The id must be 1–64 ASCII letters/digits/underscore/dot/hyphen, starting with a letter or digit. Filenames are distinct relative JSON basenames (not paths), max 101 characters, no traversal or separators. UTC is canonical millisecond ISO with Z within the experimental IERS window 1972-01-01 through 2027-06-27. Coordinates are WGS84 latitude/longitude in integer microdegrees and height in meters; bounds are ±90°, ±180°, and -12000..100000 m. Both the case identifier and UTC + complete observer position must be unique. **Every actual and reference filename must also be unique across the entire campaign**, preventing accidental reuse of a result or reference under a different case. At least two dates must contain the same two sites, to separate time-dependent from location-dependent errors. A declared case's UTC and coordinates are checked against the **actual computed sky**, not merely its JSON reference.

Example fictional manifest, with **no real astronomical positions or JPL data**:

    {
      "schemaVersion": 1,
      "cases": [
        {"id":"north-winter","utcIso":"2026-01-15T13:04:05.000Z","latMicro":45000000,"lngMicro":12000000,"heightMeters":120,"actualFile":"north-winter-sky.json","referenceFile":"north-winter-reference.json"},
        {"id":"south-winter","utcIso":"2026-01-15T13:04:05.000Z","latMicro":-34000000,"lngMicro":151000000,"heightMeters":10,"actualFile":"south-winter-sky.json","referenceFile":"south-winter-reference.json"},
        {"id":"north-summer","utcIso":"2026-07-15T23:04:05.000Z","latMicro":45000000,"lngMicro":12000000,"heightMeters":120,"actualFile":"north-summer-sky.json","referenceFile":"north-summer-reference.json"},
        {"id":"south-summer","utcIso":"2026-07-15T23:04:05.000Z","latMicro":-34000000,"lngMicro":151000000,"heightMeters":10,"actualFile":"south-summer-sky.json","referenceFile":"south-summer-reference.json"}
      ]
    }

The sample dates and locations do not imply real matching reference data. Before running on genuine observations, independently acquire and check reference values, raw-source SHA-256 and reduction procedures. Do not commit personal birth records, observer input files or external kernels.

## Manual offline command

From the Desktop root with Node.js 22+:

    node --experimental-strip-types scripts/ephemeris/verify-de441-campaign.mjs path/to/campaign.json

All input files must be colocated with the manifest and must be regular files, each at most 128 KiB. The reader rejects symlinks, directories, FIFOs/devices and invalid UTF-8, with no-follow/nonblocking flags where supported, plus inode, size, mtime and ctime checks before and after reading. These protections are best effort against filesystem races, not proofs of file authenticity, and must be verified on Windows too. Cases execute sequentially, without network requests, retries or file copying. Exceptions thrown while checking a returned result are counted as sanitized per-case failures, rather than aborting the entire campaign.

Exit/status:
- 0: DE441_CAMPAIGN:PROVISIONAL_ALL_WITHIN checked=N — **never scientifically certified**.
- 1: DE441_CAMPAIGN:FAILED checked=N failed=M — at least one record invalid or outside provisional thresholds.
- 2: DE441_CAMPAIGN:INVALID_CAMPAIGN / INVALID_LOCAL_FILE / ARGUMENTS_REQUIRED.

Only aggregate counts and fixed status codes are emitted; no local paths, UTC values, coordinates, individual positions or raw file data appear in CLI output.

## Tests actually executed

On Node.js 22.16.0 in a local mirror:

    NODE_NO_WARNINGS=1 node --experimental-strip-types --test tests/de441-reference-check.test.mjs tests/de441-reference-campaign.test.mjs
    # 31 passed, 0 failed on the previous campaign implementation (17 single-case + 14 campaign tests)
    node --check scripts/ephemeris/de441-reference-campaign.mjs
    node --check scripts/ephemeris/verify-de441-campaign.mjs
    node --check tests/de441-reference-campaign.test.mjs
    # all passed

**Additional matrix-hardening check on the current head:** executed `node --test tests/de441-reference-campaign-matrix.test.mjs` using the **exact GitHub campaign module** and a clearly labeled *test-only numerical comparator stand-in*: **7/7 passed**. These tests verify crossed 2×2 coverage, globally unique filenames, manifest rejection before reading, and sanitized exception handling. They do **not** exercise the real astronomical comparator. The complete pre-existing 31-test suite was not rerun on this updated head.

Exact tested Git blobs: campaign module `1b762d2adc6f297ce3b0c9f96399021c158f90bf`; matrix tests `e5e1b8d1e2da040c25519a1a6d8901ef50b53362`.

Tests cover different epochs/sites, invalid and duplicated metadata, UTC calendar/IERS bounds, suspicious filenames, more than 24 cases, one mismatching position, missing data, injected reader errors, full CLI process success/failure, symlink refusal, invalid UTF-8 and redacted output.

Verified GitHub blob matches for exact tested files:
- campaign module: 5df72e91c135aca9897e028197cb6b1b35174d05
- CLI: 766722bd8059c2e6b4cfdb0f342b050f5fd62b70
- tests: 80e2bf3162c51e22d4b7d7313ea8be63d60c1bd0

**Not executed:** Rust/Cargo compile or tests, real DE441 calculation, genuine independent JPL/NAIF numeric comparison, verified source-normalizer provenance, full Angular/Tauri build or Windows WebView2. All successful case fixtures are synthetic.

## Before scientific acceptance

Select one reviewed canonical numerical comparator from drafts #57 and #58, reconcile the different thresholds and reference-schema requirements, independently verify #59 source/query/normalizer evidence, and validate real Rust output against authentic externally preserved reference data across the matrix. Never promote a provisional match to chart-ready data; keep #51's scientific-readiness quarantine.

No GitHub Actions, main merge, production backend, deploy, release, public visibility or license change.
