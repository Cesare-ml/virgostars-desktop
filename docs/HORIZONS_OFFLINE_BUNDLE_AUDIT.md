# D-12 — Offline verification of a complete Horizons download

**Status: locally tested, manual-only, unauthenticated input audit.** This does not validate VirgoStars-Ephemeris numerical accuracy or establish that the source really came from NASA/JPL.

## Purpose

The explicit acquisition script saves ten original NASA/JPL Horizons-style text responses together with a SHA-256 manifest. The new read-only verifier makes it possible to detect changed files, incomplete folders, edited manifest metadata, incompatible response models and query-plan mismatches **after** download, without any new API calls or astronomical calculations.

It reuses the D-10 canonical query builder and the D-11 vector text parser; there is **no new astronomical reduction algorithm**.

## Operator workflow (Node.js 22+)

On a trusted computer, use a non-private, independently reviewed TDB Julian-day epoch. The following number is illustrative only:

```powershell
node scripts/ephemeris/prepare-horizons-vector-plan.mjs --tdb-jd 2460000.500000 --out 'D:\review\horizons-plan.json'
node scripts/ephemeris/acquire-horizons-vectors.mjs --plan 'D:\review\horizons-plan.json' --output-dir 'D:\review\responses-new'
node scripts/ephemeris/verify-horizons-bundle.mjs --plan 'D:\review\horizons-plan.json' --output-dir 'D:\review\responses-new'
```

The second command explicitly requires Internet access; the third is **offline**. The directory must contain exactly eleven entries: the ten original response files plus `response-manifest.json`. The verifier reads existing files only and does not overwrite, move, fetch or normalize them.

- `BUNDLE_INTEGRITY_OK_UNAUTHENTICATED` (exit 0): all ten saved byte sequences match the locally stored response hashes, the canonical query URLs match their hashes, and the restricted response format is internally coherent
- `BUNDLE_REJECTED` (exit 1): a missing/unsafe file, malformed or extra metadata, hash mismatch, unsupported response envelope, incorrect body/center/frame/time, or other inconsistency was found

Only fixed result/reason codes are printed. The code does not print astronomical vectors, TDB epochs, user birth details, full query URLs, response contents or local filesystem paths.

## Bounds and provenance checks

The plan and response manifest are limited to 64 KiB each; each original response is limited to 512 KiB. The verifier refuses symlink files and symlinked output folders and checks file identity/size/metadata on reads where the operating system supports those checks. Files are read sequentially; this **is not an atomic filesystem snapshot**. An adversary with control of the bundle could manufacture self-consistent input and hashes or exploit concurrent file-replacement races.

The response manifest is strictly checked against the canonical plan: ten exact ordered target IDs, SHA-256 of every exact query URL and response, matching target/filename and origin/frame/epoch, and no unexpected metadata. The response parser verifies the one-row ICRF geometric vector format and the original NASA/JPL Horizons-style text envelope.

### Official API-format changes

The [JPL Horizons API guide](https://ssd-api.jpl.nasa.gov/doc/horizons.html) documents numeric `TLIST` entries as **individually quoted Julian days**. The D-10 plan now produces URL-encoded single quotes, e.g. `TLIST=%272460000.500000%27`, with explicit `TIME_TYPE=TDB` and `TLIST_TYPE=JD`. Existing plans with unquoted numeric `TLIST` must be regenerated, as the strict validator intentionally refuses them.

The official API guide is version 1.3 (June 2025), but its **example text wire envelope** begins with `API VERSION: 1.0` and `API SOURCE: NASA/JPL Horizons API`. The parser currently accepts that documented text wire version only. If the real API uses a different header or version, **stop acquisition and review genuine samples before expanding the parser**, rather than silently accepting an unknown response. A matching header is just a self-claim, not source authentication.

## Important scientific limits

- A matching hash proves **local byte consistency**, not source authenticity, ephemeris version or reference independence. The source label `DE441` remains untrusted.
- The stored vectors are **solar-system-barycentric ICRF Cartesian** states. The experimental Desktop sky is **topocentric geometric, mean-of-date**. Directly comparing their angular coordinates is scientifically invalid. Independent reviewed transformations and model/epoch/observer equivalence checks are mandatory.
- Keep all experimental outputs out of end-user validated charts. Do not use the result to bypass the scientific-readiness quarantine.

## Executed tests and missing gates

In an isolated local mirror using Node.js v22.16.0, `node --check` passed for the three scripts; `node --test tests/acquire-horizons-vectors.test.mjs tests/verify-horizons-bundle.test.mjs` gave **31/31 PASS** (16 acquisition + 15 new end-to-end file-integrity cases). The test fixtures are deliberately fictional; they use simulated HTTP and real temporary files, including mutated digests, reordered/missing records, symlinks, invalid origins, rejected status claims and CLI path redaction.

Not executed: any live NASA/JPL request or genuine response verification, actual DE441 parity, scientific normalization, Rust/Cargo, full Angular/Desktop npm tests, Windows WebView2/Tauri, a product release, GitHub Actions or merge. The older plan-generator test suite should also be rerun on a complete checkout following the quoted-TLIST contract change.
