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
- `tests/profile-status-generation-source.test.mjs`: seven read-only Node
  source-contract checks covering native IPC isolation, opaque instance-bound
  tickets, checked epoch advance, poison/overflow handling, and coverage of
  Rust regression scenarios.

The fence provides three lifecycle operations:

1. `begin()` invalidates any older status read and returns a token for the
   newest generation, or `None` on poisoned/overflowed state.
2. `complete(&ticket)` consumes **only** one reply for the current generation.
   Copies and old replies return `false`. Ticket instances are distinguished by
   `Arc::ptr_eq`; equal numeric generations from separate fences never match.
3. `invalidate()` revokes pending replies synchronously on a future lock,
   logout, profile switch or teardown.

`is_current()` is a non-consuming freshness hint; it must **not** be used to
authorize data reads through a check-then-use sequence. The fence uses a
`Mutex` and no unsafe code. If a generation overflows it fails closed; if
the state mutex is poisoned, new reads cannot begin and old replies are
rejected. It contains no profile ID, actual account state, keys or privileges.

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
hashes: Rust module `e33b6bbde06e4b41e45fb46cf53896d1bf70a22a`,
native module registration `c0f00c5496d5b615f67a468f1279d32abbbb61c2`
and source audit `f8eafb03020c4f2a5d8df61b312f2e3fda998582`.

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
