# Native profile-status generation fence — internal Rust prototype

**Status: proposed native foundation; Rust unit tests written but not yet compiled or executed.**
This is a standalone, synthetic-only lifecycle helper. It is **not** a
working secure offline profile, storage API, authentication, SQLCipher adapter,
keychain, server sync engine or Tauri IPC command.

## What changed

- `src-tauri/src/profile_status_generation.rs`: pure std Rust
  `ProfileStatusGenerationFence` with opaque `ProfileStatusTicket`.
- `src-tauri/src/lib.rs`: compiles the internal module without registering
  a Tauri handler or modifying the existing two-command IPC allowlist.
- `tests/profile-status-generation-source.test.mjs`: source-only Node
  source-contract checks covering native IPC isolation, opaque instance-bound
  tickets, checked epoch advance, poison/overflow handling, and coverage of
  Rust regression scenarios.

The fence provides three lifecycle operations:

1. `begin()` invalidates any older status read and returns a token for the
   newest generation, or `None` on a poisoned, overflowed **or permanently
   retired** profile fence.
2. `publish_hint(&ticket, hint)` atomically **consumes the newest ticket
   and saves a synthetic UI presentation hint under the same Mutex lock**.
   Copies and old replies return `false`. Ticket instances are distinguished
   by `Arc::ptr_eq`; equal numeric generations from separate fences never match.
3. `visible_hint()` reads the current presentation-only value, or `Blocked`
   on poisoned/invalidated state; a new `begin()` immediately resets it.
4. `invalidate()` revokes pending replies, clears the visible hint and
   **permanently retires this fence instance** on lock, logout, profile switch
   or teardown. Repeated calls are safe; no method on that instance reopens it.

The old check-only `is_current()` and separate `complete()` APIs were
**removed**, so callers cannot perform a check-then-publish sequence that
races a simultaneous logout. The only nonblocked value is explicitly called
`SyntheticReady` and is not permission to read data. The fence uses a
`Mutex` and no unsafe code. If the generation overflows, it fails closed;
if the state mutex is poisoned, new reads cannot begin and hints stay blocked.
It contains no profile ID, actual account state, keys or privileges.

## Critical security separation

A ticket only means that a synthetic **status** callback is not stale. It
does **not** prove an account, local unlock, encrypted database integrity,
remote revocation or ownership. A future vetted Rust storage adapter must
enforce all real permissions, profile isolation and secret lifetime within
the native host. The frontend and these freshness tokens cannot enforce
access. Neither this module nor its tests are connected to Tauri commands,
SQLCipher, actual records, production auth or network APIs.

A disconnected device still cannot discover an unseen remote revocation.
There is no promise of immediate server revocation while offline. Never
enable a native `unlocked` response or status-derived data access until the
independent keychain/SQLCipher and authorization gates are reviewed.

## Verification

The actual GitHub committed new files match the locally checked Git object
hashes as of the latest atomic-publication change: Rust module
`8be7697980bc1f79fc82c20bc4378ff6dbdacdae`,
native module registration `c0f00c5496d5b615f67a468f1279d32abbbb61c2`
and source audit `8999c74b04270ad3a1d916b037c048607c6cc0bd`.

**Executed in a local mirror, Node.js 22.16.0:**

```sh
node --experimental-strip-types --test \
  tests/profile-status-generation-source.test.mjs \
  tests/offline-profile-notify.test.mjs tests/offline-profile-timeout.test.mjs
```

**25/25 passed** (7 source-audit tests and 18 TypeScript behavior tests).
Standalone TypeScript 5.8.3 strict compilation of the status reader and
generation guard also passed. The source audit cannot validate Rust semantics
or replace native compilation.

**Written but NOT executed (no Rust compiler available in authoring runtime):**

```sh
cd src-tauri
cargo test --locked profile_status_generation -- --nocapture
```

The seven Rust unit tests cover latest-only/once-only, logout invalidation,
cross-instance rejection, 10,000 refreshes, 16 competing completions,
overflow and poisoned mutex. A contributor must run `cargo test --locked`
with Rust 1.90 or later and review its real output before merge. The
complete `npm test`, Angular/Tauri builds, native SQLCipher and Windows
WebView2 smoke were **not executed**.

## Standalone native Rust test gate (follow-up, 2026-11-14)

A new **dependency-free Node launcher** `scripts/test-profile-status-rust.mjs`
provides a direct route to compiling and executing only the seven pure-std
Rust tests above. It does **not** invoke Cargo, Tauri, npm install, a
network endpoint, a registry or a production account. When Rust 1.90+ and
the platform-native linker are installed:

```powershell
node scripts/test-profile-status-rust.mjs
```

The runner validates the local checked-in Rust source, compiles it with
`rustc --edition=2021 --test` into a fresh OS temporary directory, runs
the resulting native test binary, and compares Rust's actual reported
passing-test count to the number of `#[test]` functions in the source.
It rejects missing compilers, compiler failures, crashes, timeouts and
zero/missing/incorrect test results. Both processes use explicit argument
arrays, `shell: false`, bounded execution times and buffered output.
The temporary binary and directory are removed in a `finally` block.
Detailed compiler errors, raw paths and runtime diagnostics are **not**
echoed to the console; only fixed diagnostic codes are printed on failure.
This launcher cannot replace the full locked Cargo/Tauri test gate.

### Verified here

- **Node 22.16.0, real runner unit tests:** `node --test
  tests/profile-status-rust-runner.test.mjs` → **7/7 PASS**. The tests
  use a deterministic fake compiler/process runner to check fixed
  compiler arguments, isolated temporary execution, no shell, output count,
  failure handling and cleanup.
- **Direct runner without a fake compiler:** `node
  scripts/test-profile-status-rust.mjs` → **`RUST_FENCE_COMPILER_UNAVAILABLE`
  (exit 1)** because this execution environment does not contain
  `rustc`. **No Rust compilation or Rust unit test execution occurred.**
- **All available local mirror Node tests:** `node
  --experimental-strip-types --test tests/*.test.mjs` → **32/32 PASS**,
  including the seven new runner tests and the earlier 25 static/TypeScript
  checks. TypeScript 5.8.3 strict compilation also passes for the UI
  lifecycle modules.
- The exact locally tested runner and test-source Git blob SHA-1s match
  GitHub: `8063f73a6fcbba96f8cb26596172c79904cd4f48` and
  `d52b21d454194d9bd763179ad5910e49f4308ee6`.

**Still required:** run this command with a real local Rust compiler, then
`cd src-tauri && cargo test --locked` with the full pinned dependency set,
`npm test`, the Angular build and Windows WebView2 acceptance. Mock
process-runner tests are **not evidence** that Rust code compiles, and this
gate does not enable local authentication, encrypted profile storage, or
account access.

## Rust test runner artifact validation (2026-11-14 follow-up)

The standalone `scripts/test-profile-status-rust.mjs` runner now rejects a
compiler that reports exit 0 **without writing a real executable**. Before
attempting execution, it checks that the generated file exists inside its
fresh temporary directory, is a regular file rather than a symbolic link,
and has a nontrivial size (at least 128 bytes). Failures produce the
generic diagnostic `RUST_FENCE_BINARY_INVALID`, with no source path or
compiler output leaked to the user.

It also requires **exactly one complete libtest summary** containing the
expected number of passing tests and zero failed, ignored, measured and
filtered-out tests. An exit code of 0 plus partial or missing output, or a
summary reporting skipped tests, cannot count as complete verification.
This is a test-runner consistency check, not a cryptographic validation of
the compiler or binary; Rust/Cargo and OS-level trust remain separate.

### Local verification

Using exact source files that match the committed GitHub Git blob hashes:

```sh
node --test tests/profile-status-rust-runner.test.mjs
node --experimental-strip-types --test tests/*.test.mjs
node scripts/test-profile-status-rust.mjs
```

The test runner unit suite passed **10/10** (three new cases for missing,
undersized or symlinked compiler output). The locally mirrored source corpus
passed **35/35 Node tests**. The direct native command returned
`RUST_FENCE_COMPILER_UNAVAILABLE` (exit 1), because no `rustc` compiler
is installed in this authoring environment. Therefore **the seven Rust unit
tests were not executed** and no Rust binary was produced.

Verified GitHub source hashes match the locally executed versions:
`scripts/test-profile-status-rust.mjs`:
`6d9f95b9005cfae2869582b1d3e44d27796a67a0`.
`tests/profile-status-rust-runner.test.mjs`:
`c0bc9a22d0d6aeef0616c8fbeaffee258920717b`.

The source-only mirror is not a full checkout. Still pending: real
`rustc` execution, locked Cargo tests, full repository `npm test`,
Angular/Tauri build, SQLCipher/OS keychain validation and Windows smoke.
No GitHub Actions, production data, release or merge involved.

## Atomic native status publication and lock race (2026-11-14)

The initial prototype could confirm that a ticket was fresh and leave
publication to a subsequent call. Between that check and any visible update,
another thread could lock/logout and invalidate the profile. The revised
pure-std Rust fence removes those separate methods and stores an internal
`ProfileStatusUiHint` under the same lock that validates and consumes its
generation. A new observation, local lock, logout or account change resets
the hint to `Blocked`, including the poisoned-mutex recovery branch.

All seven existing Rust test functions were updated to use the atomic API.
The concurrency test additionally tries **32 synthetic publish-vs-logout
thread interleavings** using a barrier; after both threads finish, the
stored hint must always be `Blocked`. It also fixes an uncompiled
`JoinHandle` use in the old test: joining threads now happens in
`.map(|worker| worker.join())` before filtering boolean results,
rather than trying to consume a borrowed handle inside `filter`.

**Verification executed here:** from a local mirror of the exact committed
files, `node --experimental-strip-types --test tests/*.test.mjs`
passed **39/39 focused Node tests** (including four added source-contract
checks), and TypeScript 5.8.3 strict compilation of the status reader
passed. The exact locally tested Rust file and source audit have the same Git
blob SHA-1s as the GitHub branch:
`8be7697980bc1f79fc82c20bc4378ff6dbdacdae` and
`8999c74b04270ad3a1d916b037c048607c6cc0bd`.

**The seven Rust unit tests remain unexecuted.** Running the real gate
`node scripts/test-profile-status-rust.mjs` returned
`RUST_FENCE_COMPILER_UNAVAILABLE` (exit 1); this environment has no
`rustc`/`cargo`. Static source checks and reasoning do not prove a
successful native compilation. Full `cargo test --locked`, project npm
tests, Angular/Tauri build, WebView2, keychain, SQLCipher, actual profiles,
identity and authorization all require separate review and execution.

`SyntheticReady` is **only an internal test/UI hint**. No native command
was added, no actual profile was unlocked, and the UI still cannot authorize
local database reads. Any later status adapter must enforce all real
security boundaries independently, and the frontend must also suppress
late UI callbacks after logout.

## Permanent native profile retirement (2026-11-14)

A review uncovered a native lifecycle gap: the earlier `invalidate()` blocked
old completions but still allowed the **same fence** to issue new `begin()`
tickets. That is acceptable for transient refresh cancellation but **not**
for a native logout, profile switch or local lock, where the old lifetime must
never be resumed accidentally.

The internal `GenerationState` now has an initially-false `retired` latch.
`invalidate()` sets it to true under the same mutex as the blocked UI hint,
including on the poisoned-mutex recovery path. `begin()` thereafter returns
`None`; `publish_hint()` rejects every reply; `visible_hint()` returns
`Blocked`. The retired state is permanent and is not reset by retries or
another `invalidate()`.

A **new fence** is required for a new profile lifetime, and must only be
created by a future independently reviewed Rust adapter after actually
checking the new profile's identity, encrypted DB key ownership and unlock
policy. The current prototype **does not provide that authorization,
database, keychain, authentication or native IPC**. `SyntheticReady` cannot
be used as permission to read data. The reusable TypeScript status reader
remains only a presentation component; a native retired fence must not be
reopened merely because the WebView asks for a refresh.

Two additional Rust unit tests were written:
`retired_profile_stays_closed_after_10000_retry_attempts` and
`profile_switch_uses_independent_new_fence`. The updated Rust module now
contains **nine** test functions, **not executed** (the authoring environment
still has no `rustc` or `cargo`). The compiler runner's injected fake-test
fixture now derives the expected count from the source rather than hardcoding
seven, and the Node source-audit identifier expression accepts digit suffixes
in legitimate Rust test names.

### Checks performed

- **14/14 source-contract checks executed directly on the exact current
  GitHub source**: internal-only module, unchanged two-command Tauri IPC,
  latest-only atomic publication, one-way retired state, cross-fence unit
  tests, poisoned state and updated test inventories.
- **18/18 Node UI lifecycle tests and 10/10 Node compiler-runner tests
  passed** using the unchanged matching local components. Strict TypeScript
  type-check of the unchanged local lifecycle modules passed.
- Exact current GitHub blobs after this change: Rust
  `33eb566ea5fe82b765ab463e1e627f1d2475d411`, Rust source audit
  `3a48b30fd2cf203d8e406923c58ce5b0f5a55a33`, compiler-runner tests
  `29a0145c5d1504c606b313bff4a40dd959246738`.
- **Not completed:** compiling or executing any Rust tests, full current
  Node repository test suite, Cargo/Tauri, Windows GUI smoke, native
  SQLCipher, keychain, identity, cloud sync, real profile access. The Node
  28/28 checks are not a Rust compilation result. Run the nine real tests
  with the checked-in standalone Rust compiler runner and `cargo test
  --locked` on an authorized Rust-equipped machine before merge.

This is a synthetic internal guard, not real native profile locking or a
security authorization system. No release, GitHub Actions, main merge,
private data, production service or Tauri IPC permission was changed.

## Next gates

1. Review native Rust semantics and run all Cargo unit tests in an authorized
   Windows toolchain with the existing two-command IPC registry audit.
2. Implement native *profile-specific* encrypted storage and key validation
   separately. Bind the fence only to a reviewed profile-lifecycle adapter;
   do not return keys, account identifiers or arbitrary paths to the WebView.
3. Test rapid account switching, lock/logoff and delayed native operations
   against real native cancellation and authorization policy. An internal
   freshness fence is not a replacement for the storage security model.

No GitHub Actions, release, visibility change, deployment, production
connection or merge is included in this prototype.
