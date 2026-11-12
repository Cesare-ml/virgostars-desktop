# D-05 — Preserve and verify the independent reference evidence

**Status:** offline byte-evidence verification, locally tested on synthetic files. **Not** scientific certification, a verified JPL response, or an enabled desktop ephemeris.

## Why

Draft #58 compares experimental VirgoStars-Ephemeris output to a normalized reference and checks the saved raw response against its SHA-256 digest. But the normalized reference also declares two further digests (the original query and independent normalizer source) that were **not checked against files**. Without these files, a reviewer cannot reproduce which Horizons configuration or independent reduction algorithm produced the numbers.

This additive command verifies that **all three preserved source files really match the exact digests in the reference metadata**. It does not call the JPL service, normalize coordinates or perform astronomical calculations. It does not alter the existing comparison module or the production application.

## Local input files

The command requires four **distinct regular files**:

- `--reference`: the normalized reference JSON v1 from [D-04](INDEPENDENT_DE441_REFERENCE_COMPARISON.md), containing a `provenance` object.
- `--raw-source`: the original, **unmodified** JPL Horizons response claimed by the reviewer.
- `--raw-query`: the saved exact raw query/request used to obtain that response, with relevant parameters, targets, centers, time scale, frame and correction configuration.
- `--normalizer-source`: the versioned source program used independently to reduce the response into the D-04 normalized reference schema.

The JSON `provenance` object must declare `source: "JPL_HORIZONS"`, `rawResponseSha256`, `querySha256`, `normalizationCodeSha256`, and printable `normalizationNotes` (20–400 characters), with no extra provenance fields. All three digests are lowercase 64-character SHA-256 strings.

## Run manually (Node.js 22+)

```powershell
node scripts/ephemeris/verify-reference-evidence.mjs --reference .local/review/reference.json --raw-source .local/review/horizons-raw.txt --raw-query .local/review/horizons-query.txt --normalizer-source .local/review/normalize-reference.py
```

Then, **only if the evidence check reports `EVIDENCE_BYTES_MATCH`**, run the independent numeric comparison from D-04 separately with its explicit reviewer-approved tolerances. A passing evidence check alone is not a complete D-04 numerical audit.

The verifier uses at most 1 MiB blocks and enforces file-size caps: reference JSON 128 KiB, original response 32 MiB, query 128 KiB, normalizer source 1 MiB. It refuses symlinks, non-files, missing/empty/oversized files, reused file identities and files altered during reading (as detectable by metadata checks). Files remain on the operator's device and are opened read-only. On errors, only fixed reason codes appear; source paths, query contents, birth coordinates and raw responses are not printed.

## Outcomes and limitations

- `EVIDENCE_BYTES_MATCH` means saved bytes match all three **self-declared** digests. This makes an audit trail reproducible **relative to those digests**.
- `EVIDENCE_REJECTED` with a fixed reason means a file, provenance object, or hash could not be trusted for this review.
- No claim of independent reduction, authenticated JPL delivery, correctness of the query configuration, compatibility of physical corrections, numeric agreement, or a validated sky follows from a match. An attacker could fabricate four mutually consistent files; an independent reviewer must still authenticate source, query, code and scientific setup.
- The D-04 CLI remains separately invocable, so this is an **additional manual review gate** rather than enforced integration into every comparison. Do not mark the comparison pipeline production-safe until these gates are combined and reviewed.
- No native Tauri IPC, Cargo linkage, kernels, accounts, deployment, release, license/visibility change or automatic GitHub Actions.

## Actual tests

On Node.js 22.16.0, `node --test tests/verify-reference-evidence.test.mjs` gave **14/14 pass** using fictional data. `node --check scripts/ephemeris/verify-reference-evidence.mjs` passed. The exact locally executed source and test files matched GitHub readback:

- Script blob: `a4ea9be42674c66d0005caf8d171eb6a1a8c3008`
- Test blob: `98e69740e23ee2dd82f5963cddd8873ba2c787fe`

The full desktop test suite, real Horizons calls, authentic DE441 comparisons, Windows WebView2, Angular build and Rust/Cargo tests were **not** run.

**Dependency:** stacked on draft PR #58 → #55 → #48 → #47. Review/validate in dependency order; no main merge in this increment.

## D-07 follow-up: normalized reference fingerprint

The verifier also returns a lowercase SHA-256 of the normalized reference JSON bytes as `referenceSha256` to its in-process caller. This digest **is not printed in normal CLI output** and is not a certificate. The D-06 combined audit compares that value before and after the numeric check to reject edits to the normalized JSON itself. The three separate original-query/response/normalizer digests remain independently required. This still uses separate file opens, so an adversarial concurrent replacement race is not fully eliminated.
