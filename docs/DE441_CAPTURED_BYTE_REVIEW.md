# D-09 — Captured-byte DE441 review without re-opening astronomical JSON

**Status:** offline, locally tested review utility. This is **not** a certified scientific ephemeris, an automatic desktop calculation provider or an authenticated JPL Horizons data pipeline.

## Purpose and trade-off

The D-06 verifier in draft PR #59 reopens the normalized reference and experimental sky JSON during the numeric comparison and rechecks evidence afterward. D-08/#65 hardens those individual file reads. D-09 adds a separate manual entry point that captures five input files **once**, verifies the exact captured bytes and then runs the **existing** `compareExperimentalSky` pure function on the captured JSON objects. In particular, the reference used for provenance validation is exactly the same reference used for numerical comparison; the experiment JSON is not reread after its fingerprint was computed.

The five inputs are: experimental DE441 sky JSON, normalized reference JSON, original JPL Horizons response, saved raw Horizons query and separately reviewed normalization-code source. All remain local. The two JSON files are capped at 128 KiB and retained in RAM; the raw source (32 MiB cap), query (128 KiB cap) and normalizer source (1 MiB cap) are **SHA-256 streamed**, not retained in RAM. Total active chunk memory is bounded to 1 MiB per reader; inputs are read sequentially. Reuses the same symlink/regular-file, descriptor identity, path identity and file metadata checks from #65. Five distinct inodes are required. Fatal UTF-8 parsing and the existing D-05 provenance-hash rules are applied before any numerical comparison.

### Manual command (Node.js 22+)

```powershell
node scripts/ephemeris/run-captured-de441-audit.mjs --actual .local/review/experimental-sky.json --reference .local/review/reference.json --raw-source .local/review/horizons-response.txt --raw-query .local/review/horizons-query.txt --normalizer-source .local/review/normalizer.py --max-direction-arcsec 1 --max-distance-ppm 10 --max-epoch-seconds 0.1
```

The tolerances above are **illustrative only**; they are NOT approved accuracy targets. Uses the same strict CLI parsing as D-06 and the same 10-body topocentric geometric model/schema from D-04. Does not implement new astronomy. The only exposed summaries are `CAPTURED_WITHIN_TOLERANCE_EXPERIMENTAL`, `CAPTURED_OUTSIDE_TOLERANCE_EXPERIMENTAL` or `CAPTURED_AUDIT_BLOCKED`; fixed diagnostic codes and maximum angle/distance/epoch discrepancies are allowed. Pathnames, UTC birth data, coordinates and original reference values are not printed. The `scientificallyValidated` flag is always `false`.

## Critical limitations

This is a **self-consistent captured-byte set, not an atomic filesystem snapshot**. The five files are opened in sequence, so their bytes might originate at different times. The existing reader detects many in-place changes and path substitutions during each read, but deliberate replace-and-restore races across file reads remain possible. Unlike the existing D-06 path, this new command does not reread the files to detect changes **after** their individual capture; it simply reports on the specific captured bytes. Keep this manual-only until a separate threat-model review chooses a desired policy for concurrent mutations.

Likewise, SHA-256 agreement between self-supplied files does not authenticate JPL, guarantee that the normalizer is independent/correct, establish equivalent reference frames or prove scientific accuracy. A purely synthetic self-comparison can return a within-tolerance result. Neither D-09 nor D-06 may enable chart-ready astronomical outputs; PR #51's quarantine remains required. A true scientific release still requires authentic external reference vectors and independent cross-validation across bodies, dates and physical corrections.

## Validation performed

Node.js v22.16.0, local mirror of the existing GitHub source stack plus the minimal #65 reader hardening and D-09 change:

```text
node --test tests/*.test.mjs
# 67/67 PASS: 52 prior D-05/D-06/D-07/D-08 tests + 15 true-filesystem D-09 tests
node --check scripts/ephemeris/verify-reference-evidence.mjs
node --check scripts/ephemeris/run-captured-de441-audit.mjs
# PASS
```

Tests use only fictional astronomical values. The additional 11 standalone tests introduced by #65 were **not** reproduced in this local mirror. The full repository npm/Angular test suite, Rust/Cargo, real JPL kernel/Horizons values and Windows Tauri/WebView2 were **not run**.

Draft stacked on #65 → #59 → #58 → #55 → #48 → #47. No CI/GitHub Actions, public visibility change, release, merge, deploy, network fetch or production data change.
