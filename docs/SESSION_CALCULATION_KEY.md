# Ephemeral natal preview calculation identity (HMAC v1)

**Status: standalone, locally tested TypeScript utility; deliberately not connected to the current #94 preview queue or a native calculation provider.**

## Why

The unavailable-only integration in #94 uses `natal_preview_N` as a correlation marker. That number is sufficient for its mock provider, but it does not identify identical calculation inputs and is not a safe foundation for future cache/deduplication logic. Serializing a raw birth timestamp, coordinates, city or name directly into a calculation key could also leak sensitive data through traces and logs.

`src/app/session-calculation-key.ts` now exports `SessionCalculationKeyV1.create()` and `forPreview(candidate)`, a separate, intentionally opt-in solution for exactly the **existing provisional/unavailable natal preview contract**.

## Design

- Generate a **fresh 256-bit, non-extractable HMAC-SHA-256 WebCrypto key** for each application preview session (`crypto.subtle.generateKey` with `extractable=false`). Keep the `CryptoKey` private and only in memory.
- Canonicalize **all 11 current candidate fields** in a fixed positional order with an explicit version/domain separator. The fields cover exact UTC timestamp, microdegree latitude/longitude, IANA timezone ID, historical offset seconds, bundled timezone version/caution, explicit unverified source, and declared provider ID. Subject name and location display labels are not inputs or outputs.
- Reject unknown or missing properties, malformed timestamps/coordinates/offsets, invalid version/provider IDs, or anything that claims a validated scientific state. A future scientific computation option (houses, zodiac, ayanamsa, time model, kernel etc.) **must require a new version** with all new inputs included, not silently reuse this preview-only v1.
- Return `natal_hmac1.<64 lowercase hex digits>` (76 chars), satisfying the current queue's bounded allowed character format; stable for identical input **in one session**, intentionally unrelated between sessions.
- Fail closed when WebCrypto or secure key generation/signing is unavailable. No fallback to unsalted SHA-256, noncryptographic hashes or concatenated personal data.
- `dispose()` retires the keyring and rejects a result from cryptographic work already in flight, even if the underlying asynchronous WebCrypto operation cannot be cancelled.

## Security and science boundaries

This reduces incidental raw-input exposure in an ephemeral correlation key; it is **not** a replacement for encryption of actual birth records, device secrets, operating-system keychain, trusted native validation, account isolation or Rust scientific precision checks. The HMAC key is generated and held in the WebView/renderer; it is **not safe against an attacker able to execute arbitrary script in the same WebView**. Disposal drops references but cannot guarantee cryptographic RAM erasure.

A key deliberately does not persist or allow cross-session equivalence. Do not use it as an account ID, auth token, cloud cache key or durable chart identifier.

The #94 adapter remains **unchanged**, hard-coded to an unavailable-only local port with its old sequential demo marker. This PR only creates a tested keyring. Future integration will require review of asynchronous digest generation and stale-request cancellation before substituting the marker in #94. It will still not be permission to activate real Rust calculations.

The UTC conversion and provider date coverage remain explicitly **provisional**; independent Rust validation and #51/#61 scientific quarantine must remain in force.

## Tests executed

Local: Node.js 22.16.0 and TypeScript 5.8.3.

`node --experimental-strip-types --test tests/session-calculation-key.test.mjs`: **11/11 PASS**.

`tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/session-calculation-key.ts`: **PASS** with a local type-only stub for the existing ProvisionalNatalCandidate interface.

Tests exercise genuine Node WebCrypto HMAC signing, stable identities in one session, distinct identities across independent sessions, domain separation for changed input fields, insertion-order independence, absence of raw source strings, failure on extra/missing/malformed fields, missing or insecure crypto, disposal, a deferred crypto race and invalid signature lengths.

New GitHub blobs match the exact locally tested file hashes: implementation `d88b8fd14a14ee1b9dc676e51f8f53d334baf597`, tests `4610132b39266f8cb54c5e26ec8d6363053393ba`.

**Not executed:** complete repository `npm test`, production Angular build, real browser/WebView2 WebCrypto smoke, Windows/macOS native builds, Rust IPC, real DE441 science, saved chart flow or account/cloud service. All test data are fictional.

No external dependencies, GitHub Actions, main merge, release, server/production modifications, logging, storage, user data or visibility changes.
