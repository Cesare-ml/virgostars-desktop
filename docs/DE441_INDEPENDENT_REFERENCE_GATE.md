# DE441 independent-reference comparison gate

**Status: Node-tested comparator and CLI; NOT independent scientific validation.** This is an opt-in offline developer tool. It does not calculate astronomy, install kernels, modify Tauri/Angular, authorize chart-ready results, or change production.

## Purpose and limits

The standalone Rust first_sky experiment in draft #48 generates unverified geometric topocentric positions from an externally obtained classic DE441 kernel. Before presenting genuine charts, its numerical output must be compared with a **separately derived, independently inspected** JPL/NAIF reference reduced to the *same* frame, targets, UTC time scale, WGS84 observer and physical correction model.

The new JavaScript comparator:
- verifies the existing ExperimentalSkySnapshotV1 first, including 10 body identities and 9 disclosed model approximations;
- requires a matching independent-reference record with explicit provenance claims and source-document fingerprint;
- rejects mismatched UTC, latitude/longitude, height, geometric/apparent model, equator/ecliptic frame, duplicate or incomplete bodies, extra/private fields, and nonfinite values;
- calculates shortest 0/360 circular angular difference for longitude, right ascension and azimuth, and direct differences for latitude, declination, altitude and kilometer distance;
- returns only bounded failure identifiers and maximum deviations; the CLI prints fixed sanitized statuses.

The provisional diagnostic thresholds are: ecliptic longitude/latitude and right ascension/declination **1 arcsecond** (1/3600 degree); altitude/azimuth **0.003 degree**; distance **10 km**. These numbers are NOT proven realistic scientific accuracy limits. Review the reference model and its transformations before changing a threshold.

A result within provisional thresholds **does not prove correctness**: an invented or copied reference can pass. Provenance labels or SHA-256-shaped strings are only declarations. Humans must independently inspect the original JPL/NAIF document, its actual hash, method of mean-of-date reduction, observer position, Earth orientation, and the difference between outer planet centers and planetary-system barycenters. Apparent JPL Horizons positions must not be compared directly with geometric positions. Do not populate reference files by copying VirgoStars-Ephemeris results.

## Independent-reference JSON schema v1

The reference object must have exactly these top-level keys:

schemaVersion, sourceKind, sourceId, sourceDocumentSha256, transformMethodId, utcIso, latMicro, lngMicro, heightMeters, observerDatum, frame, geometry, positions.

Required values:
- schemaVersion is 1;
- sourceKind must be JPL_HORIZONS or NAIF_SPICE (claimed; not independently authenticated by software);
- sourceId and transformMethodId are separately reviewed IDs, 8-128 permitted ASCII characters;
- sourceDocumentSha256 is the **real** lowercase SHA-256 of the raw independent external reference document, not a typed placeholder;
- UTC and observer coordinates/height must exactly equal the experimental sky;
- observerDatum is WGS84, frame is mean_ecliptic_and_equatorial_of_date, geometry is topocentric_geometric;
- positions contains exactly ten distinct records with bodyId, centerKind, longitudeDeg, latitudeDeg, rightAscensionDeg, declinationDeg, altitudeDeg, azimuthDeg, distanceKm.

Supported IDs: sun, moon, mercury, venus (centerKind body_center), plus mars_barycenter, jupiter_barycenter, saturn_barycenter, uranus_barycenter, neptune_barycenter, pluto_barycenter (centerKind system_barycenter). Angles are degrees; distances kilometers. Null azimuth matches only null azimuth. Any unexpected schema fields are rejected.

## Manual offline workflow

1. With Cargo and an authorized separately obtained classic DE441 file, produce an experimental JSON snapshot via the isolated bridge documented in docs/DE441_JSON_BRIDGE_SPIKE.md. Store it in a local untracked file, never the repository.
2. Independently generate and reviewer-verify an external JPL Horizons / NAIF SPICE reference and transformation to exactly the same *geometric topocentric, mean equator/ecliptic of date* model. Record the original source document's real SHA-256 and a separately audited transformation method. Horizons does not automatically provide the required model as-is.
3. From the Desktop repository root run:

    node --experimental-strip-types scripts/ephemeris/verify-de441-reference.mjs path/to/experimental-sky.json path/to/independent-reference.json

Status codes: exit 0 = WITHIN_PROVISIONAL_LIMITS_REVIEW_ONLY (never certified); exit 1 = MISMATCH count=N; exit 2 = INVALID_INPUT or ARGUMENTS_REQUIRED. Each file is read with a 256 KiB maximum and output never exposes local file paths, coordinates or raw data. The CLI first checks the input with `lstat` and rejects symlinks, directories, devices, sockets and named pipes. It uses non-follow/nonblocking open flags where supported, verifies inode/size/mtime/ctime stability around the read, detects growth/shrinkage, and decodes UTF-8 in strict mode. These checks are **best-effort race defenses**, not a cryptographic authenticity guarantee for files on a concurrently writable or hostile filesystem. In particular, Windows support for no-follow/nonblocking flags depends on its platform implementation; use operator-controlled regular files. The JS function compareExperimentalToReference reports individual mismatched body/field names and maxima to a *local reviewer* when explicitly used programmatically.

## Actually executed checks

Node.js 22.16.0: **17/17 tests passed**, including the original 14 cases and three new regression cases exercising symlink rejection (subject to Windows symlink permission), nonblocking rejection of Unix named pipes, directory refusal and invalid UTF-8. Existing cases exercise a real local JSON CLI invocation against synthetic fixtures, angular wrapping, provenance/schema failures, missing/duplicate targets, invalid numbers, mismatched observing conditions, bounded reads and private-output containment. `node --check` also passed for the updated CLI and test file. The exact tested Git blobs match GitHub: CLI `a739d85b07e691c3a2152e7f3db817d7785a4ec3`, tests `324ee4f7ff1599f9794ab564df9896e7fc4dc654`. No real astronomical reference was downloaded or compared.

Still missing: Cargo/rustc compilation, actual DE441 kernel calculation, independent JPL/NAIF numerical fixture generation and scientific accuracy review, Windows Tauri/WebView2 and full Angular build. All test positions are deliberately synthetic; they are not approved reference ephemerides.

## Integration

The feature PR is stacked on draft #48, which depends on #47. Draft #51 (quarantine), #54 (kernel preflight) and #55 (smoke runner) implement complementary safeguards. None of these proves scientific accuracy or enables real charts. The synthetic renderer and the explicit native EPHEMERIS_NOT_INTEGRATED state remain unchanged.

No GitHub Actions, merge, production backend modification, deploy, publication or license change is performed. Integration into astrological-functions or astrological-charts remains prohibited until a separate, independently validated production-ready data contract is reviewed.
