# D-18 — JPL Horizons transport-version probe (manual, opt-in)

**Status: locally tested utility; live wire version observed, vector format NOT yet reviewed.**

## Compatibility problem discovered on 2026-11-13

On 2026-11-13, the real public endpoint
`https://ssd.jpl.nasa.gov/api/horizons.api?format=text`
returned the transport preamble `API VERSION: 1.2` and `API SOURCE: NASA/JPL Horizons API`, followed by the expected error about a missing `COMMAND`. This is a **live metadata-only response**; it is not a query for or acquisition of any astronomical vector.

The official [Horizons API reference, v1.3 (June 2025)](https://ssd-api.jpl.nasa.gov/doc/horizons.html) still illustrates a *text response* beginning `API VERSION: 1.0`. These identifiers have separate purposes: the documentation revision is `1.3`, the documented sample wire envelope is `1.0`, and the current live wire envelope was observed as `1.2`. A [September 24, 2026 example](https://juliaastro.org/EphemerisSources.jl/docs/dev/examples/horizons/) of real Horizons vector responses also shows `API VERSION: 1.2`, but does not contain the complete unabridged one-row geometric SSB vector output required by the VirgoStars acquisition contract.

The pre-existing D-11 downloader currently **fails closed** on any version other than the previously reviewed `1.0` wire envelope. This means that genuine current JPL data may not pass its first guard. **Do not blindly whitelist `1.2`**: first independently review an original unmodified 1.2 response for all relevant target/center/frame/time/vector fields, then amend the parser and add regression fixtures.

## New manual probe

```powershell
node scripts/ephemeris/probe-horizons-wire-version.mjs --probe
```

This explicit command issues one GET to the hardcoded public *metadata/error-only* endpoint, containing precisely `?format=text` and **no target, epoch, observer, birth data, credentials, API key or ephemeris parameters**. It does not run automatically when Desktop starts or when tests are imported. The implementation refuses redirects and wrong content type, caps the body at 8 KiB, times out after ten seconds and checks the two transport header lines exactly. It never prints response bodies or filesystem paths.

Possible sanitized reports:
- `WIRE_1_2_REQUIRES_VECTOR_REVIEW` — the observed new version; no vector schema is approved
- `WIRE_1_0_REQUIRES_VECTOR_REVIEW` — old sample version; no new vector schema is approved by this probe
- `UNKNOWN_WIRE_VERSION_REQUIRES_REVIEW` — a different version
- `UNRECOGNIZED_ENVELOPE` — bad, absent or unexpected header
- `PROBE_UNAVAILABLE` — HTTP, timeout, transport, format or size failure

Every returned object has `scientificallyValidated:false` and `vectorFormatApproved:false`. A transport header can be fabricated or intercepted; this probe is **not source authentication**.

## Validation actually performed

Node.js 22.16.0 in an isolated local checkout:

```text
node --test tests/strict-horizons-headers.test.mjs tests/rollback-horizons-directory.test.mjs tests/owned-horizons-writes.test.mjs tests/run-horizons-regressions.test.mjs tests/probe-horizons-wire-version.test.mjs
# 66 / 66 PASS
node scripts/ephemeris/run-horizons-regressions.mjs --suite core
# PASS, 29 tests
node scripts/ephemeris/run-horizons-regressions.mjs --suite all
# INCOMPLETE, exit 2: remaining integrated acquisition / bundle modules
```

The 13 new probe tests use **mocked** HTTP Response instances (version 1.0, 1.2, unknown, spoofed or malformed headers, redirects, size caps, UTF-8, thrown errors and CLI). No live JPL request was issued from Node.js in the test container; the live version discovery came from a separate public endpoint inspection, not the mocked tests.

The full manual Horizons regression gate now expects **99 tests** (the former 86 plus 13 probe cases). That 99-case suite remains **unexecuted** on a complete repository checkout. A green suite does not establish astronomical accuracy, DE441 parity, authentic kernel identity or that the end-user chart is scientifically ready.

## Next scientific gate

Collect genuine raw responses from JPL under the **exact** planned ten-target SSB/ICRF geometric-vector requests. Independently check wire 1.2 against documented response semantics, archive and fingerprint the original data and query, then explicitly add narrow parser support with tests. Only after that should the existing D-11 original-response downloader accept live 1.2 vectors. Keep the current experimental sky quarantine throughout.

No merge to main, GitHub Actions, deployment, release, account data or private birth records.


## D-19 — Read-only review of original 1.2 vector samples

A new dedicated command, `node scripts/ephemeris/review-horizons-wire-sample.mjs --file <local-original-response> --body sun --tdb-jd 2460000.500000`, permits **offline structural inspection** of an unmodified 1.2 vector text sample. It never downloads anything, modifies the input, returns private coordinates, or permits chart use. Even positive output is `WIRE_1_2_STRUCTURE_REVIEWABLE_UNVERIFIED`, and every readiness/authenticity flag remains false. It uses the ten canonical body names, independently reviewed TDB JD, original file identity/UTF-8 checks and the shared strict header reader. See [HORIZONS_WIRE12_OFFLINE_SAMPLE_REVIEW.md](HORIZONS_WIRE12_OFFLINE_SAMPLE_REVIEW.md).

The old D-11 acquisition parser remains **strictly pinned to wire 1.0** until genuine 1.2 source responses are acquired, provenance checked and scientific conventions reviewed; this new tool **does not** whitelist 1.2 or claim DE441 parity. Node.js 22.16.0: 16 new synthetic/real-file review tests PASS, **82/82 locally mounted tests PASS**. The full manual suite now requires 115 tests and remains **INCOMPLETE** in the partial mirror.
