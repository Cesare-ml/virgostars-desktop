# Natal HMAC signing → latest-only queue (unavailable-only)

**Status: locally tested, source-only prototype. Not wired into Angular, native IPC, real astronomy or personal-data persistence.**

This follow-up to draft PR #102 adds an **opt-in** adapter `NatalSignedQueuePreview`, rather than replacing the synchronous mock-only `NatalOfflineQueuePreview` from #94. The unchanged original `LatestCalculationQueue<never>` from #47 and the unchanged, non-exportable WebCrypto `SessionCalculationKeyV1` from #102 are both used directly. The native calculation port is **hardcoded to return a correctly correlated `unavailable` reply**. Neither a real native port nor a ready-snapshot validator can be injected by callers.

## Lifetime and bounded asynchronous work

- `static create(sessionId, notify, cryptoProvider?)` validates the bounded session ID before generating a fresh **non-extractable HMAC-SHA-256 key**. The crypto-provider override is only for deterministic isolated tests. The key is never persisted, logged or returned.
- `submit(draft, anchor, resolution, selectedUtc, coverage)` **synchronously invalidates the original queue and supersedes earlier signing tasks before its first await**, including when the next birth input is invalid. It validates the provisional candidate via the existing input freshness guard and DST/coverage contract. Unknown hour, DST gap, missing explicit fold choice or malformed provider data never starts an HMAC.
- At most **one HMAC signing operation can be active and one later request can be pending**. Subsequent input replaces the pending request and promptly resolves superseded submission promises; it does **not** launch unbounded WebCrypto operations. The first microtask also coalesces same-turn bursts.
- Once WebCrypto completes, the adapter **rechecks the live natal preview and the entire provisional UTC/candidate record** against its captured primitive snapshot. Edits during signing, even changes to the timezone database version or declared provider coverage without triggering an explicit notification, cannot dispatch the old signed request.
- The resulting `natal_hmac1.<hex>` identifier becomes the original queue's `calculationKey`. The queue does its own strict validation and remains latest-only. It returns only `{kind:'unavailable'}` (or a sanitized error) to subscribers, never a name, date, coordinate, request object or HMAC key.
- `invalidate()` cancels outstanding requests and promptly resolves active/pending signing attempts with `superseded`. `dispose()` retires the queue and keyring, resolves in-flight work with `queue_unavailable`, and makes future submissions unavailable. Cryptographic work already inside WebCrypto is not forcibly interrupted, but any later completion is ignored. If the underlying cryptographic operation never settles, **one active signer can remain blocked and delay its successor**, so this is still a prototype, not a production watchdog.

## Executed validation

Local environment: **Node v22.16.0, TypeScript v5.8.3**.

- `node --experimental-strip-types --test tests/natal-signed-queue-preview.test.mjs tests/session-calculation-key.test.mjs` → **26 / 26 PASS**.
- New signed-queue suite: **15 / 15 PASS**, including real Node WebCrypto, DST fold selection, 200 same-turn submissions, 300 replacements while a crypto operation is blocked (only two signings actually start), invalid-input supersession, edits during signing, timezone/coverage changes, disposal/invalidation, signer failure, invalid IANA zone, separate sessions and invalid constructor input.
- Existing HMAC keyring suite: **11 / 11 PASS**.
- `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/natal-signed-queue-preview.ts` → **PASS**.
- Exact local Git hashes of the new source/test match GitHub: adapter `f491500fd84610780ef661e43bde744185c54b6f`; test `59ccfe6bb8ed4ccea2cd251870226e1d04476626`. The local test harness uses **original, hash-verified** queue (`8bbfebd4e17ce7d91dfcae35b428e9df028c4369`), natal calculation candidate (`2c494c6358d9203b48c20c50783ef1ae56a76b9f`), freshness guard (`4e0e7cdf3dde4c6962cc213871a4fd6bdebe55fa`) and HMAC signer (`d88b8fd14a14ee1b9dc676e51f8f53d334baf597`) with **type-only stubs** for the full Angular natal state and timezone interfaces. The tests instantiate a synthetic compatible state fixture; they do **not** exercise the full Angular natal form or real bundled historical timezone database.

**Not executed:** full repository `npm test`, Angular strict template/production build, Windows WebView2 crypto acceptance, native Rust/Tauri integration, reliable historical timezone parity, astronomy numerical verification, offline archive, account sync or release workflow.

## Security and integration boundaries

- HMAC prevents raw personal inputs from appearing in the **ephemeral correlation key**, but neither encrypts actual birth records nor protects against malicious scripts running in the same WebView. No guarantee of memory zeroization.
- The HMAC is **not** a durable chart ID, a cloud cache key, a server authentication token, a cross-session fingerprint, or a scientifically validated cache key. Any new house-system, zodiac, time model, kernel, observer or other calculation-affecting field requires a new complete canonical contract before a real science provider.
- The `unavailable` port and `SnapshotValidator<never>` are non-negotiable for this experiment. Scientific readiness remains denied under #51/#61 until authoritative Rust ephemeris, UTC provenance and independent JPL/DE441 numerical validation are complete.
- Parent PR #102 is draft, itself depending on #94/#88/#47 and the fuller natal editor chain. PR #100 and alternate natal editor #62 must be reconciled separately. Do not merge both natal forms or duplicate queue sources.
- No new dependencies, GitHub Actions, `main` merge, production systems, public visibility change, release, deployment, real user records, network access or persistence.
