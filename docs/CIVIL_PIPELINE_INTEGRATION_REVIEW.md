# Civil-time pipeline: combined synthetic integration gate

Status: **Draft for review** — no real natal astronomy, native IPC, account, persistent birth data or production use.

## Consolidation

This branch incorporates the unchanged code and regression tests from three independent draft PRs:

- **#167** — civil-time resolver reads date/time/IANA zone once, rejects throwing getters.
- **#160** — the DST-choice boundary freezes a detached civil tuple and labels the result from that same tuple.
- **#149** — the queue handoff reads coordinates once and queues exactly the validated values.

The additional integration test in tests/civil-calculation-pipeline-integration.test.mjs composes the three real TypeScript helpers with an injected in-memory recording queue. It verifies the entire sequence from fictional civil input and synthetic microdegrees to a selected UTC instant and a pending mock request. In particular: a DST fallback requires an explicit exact UTC choice; stale selections, spring gaps, nonexistent dates, changing accessor values, throwing accessors and queue errors never produce a fabricated successful result. Lord Howe and Kathmandu offsets retain their seconds.

This does **not** add a runtime adapter or wire a real Angular form. The next UI change must use the tested composition rather than guessing UTC or bypassing DST choice.

## Actually executed on the exact combined sources

Node.js **22.16.0**, local minimal source mirror:

    node --experimental-strip-types --test tests/*.test.mjs

**41/41 PASS**: 16 existing resolver tests + 7 resolver-snapshot tests + 6 civil-input-snapshot tests + 4 location-snapshot tests + 8 new integrated-flow tests.

TypeScript **5.8.3**:

    tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/native/civil-time.ts src/app/native/civil-time-choice.ts src/app/native/civil-calculation-dispatch.ts

**PASS**. All seven edited/new source and regression test files were verified against their exact committed Git blobs after writing them to this integration branch.

## Still required before merge

- Run the *full repository* npm test suite, including baseline civil-time-choice and civil-calculation-dispatch suites not in the minimal mirror.
- Run Angular/Charts production build, Rust/Tauri validation and Windows WebView2 GUI acceptance.
- Independently compare host unpinned IANA timezone data against an approved pinned reference; native astronomy model, precision and kernel support remain unverified.
- Complete security review of the eventual session-scoped calculation key, real latest-only queue and native provider. The fixed test key is synthetic and not suitable for personal birth data.

No change to production, cloud, user accounts, encrypted storage, third-party assets, licensing, OS permissions, repository visibility, GitHub Actions, automatic merge or releases. Review this combined PR before deciding whether to close/supersede the three component drafts.
