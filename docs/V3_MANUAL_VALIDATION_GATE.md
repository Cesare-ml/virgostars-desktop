# Manual VirgoStars Desktop v3 storage validation

**Status:** prototype verification only. This document is for the isolated
fictional encrypted-outbox spike, not a desktop app release gate or a
production migration. Do not use real astrology birth records, account
secrets, production databases, cloud environments or signing keys.

## Problem addressed

The existing `crates/encrypted-outbox-spike/validate-windows.ps1`
tests older synthetic v3 cases but does not enumerate the growing
conflict-preview, keyset, full-schema, immutable request, FIFO,
conflict-history and ACK regressions. Its final PASS therefore
cannot by itself certify the current **v3 prototype**. The sibling
draft PR #35 also edits this script, so this PR deliberately does
**not** change it.

A second independent failure mode was reproduced while testing the
new script: if a Node `--test` worker spawns another Node `--test`
process, the child can inherit `NODE_TEST_CONTEXT`, **skip all test
files and exit zero**. The new runner clears that variable for the
subprocess; a regression test verifies an intentionally failing
fictional suite produces a failing exit status.

## Commands — on an authorized full checkout of this branch

Requirements: Windows 11 for the native gate, Node.js **22+**,
Rust/MSVC/SQLCipher build prerequisites and a **reviewed Cargo.lock**
for a reproducible native gate.

Start with the runner's contract tests on any OS:

```powershell
node --test tests/v3-reference-gate.test.mjs
```

For all 11 tracked synthetic SQLite v3 reference suites (without
native encryption), on Windows, macOS or Linux:

```powershell
node tools/v3-sqlite-reference-gate.mjs
```

The runner checks for exact repository paths to the three versioned SQL
schema files and **all 11 mandatory v3 suites** before running anything.
It also automatically includes future `sqlite-v3-*.test.mjs` suites.
The runner executes every suite **in a separate Node test subprocess**
and checks its TAP summary. It refuses a suite with no real test
cases (Node 22 can otherwise report a zero-test file as a passing
*file-level test*), any skipped/TODO/cancelled case, missing result
counts, a test failure, a child timeout or a nonzero exit status.
This ensures each of the 11 mandatory suites actually contributes
passing tests, rather than trusting an aggregate exit code.

Missing files, a failed or incomplete test, a truncated checkout or
unsupported Node version cause a nonzero exit code. All child executions
have a bounded timeout and output buffer. This is **reference-only**
and is not a cryptographic validation.

On Windows PowerShell, to run the complete native-gate command:

```powershell
.\crates\encrypted-outbox-spike\validate-v3-windows.ps1
```

This runs the complete v3 Node reference gate first, then invokes the
existing native `validate-windows.ps1 -SkipNode` gate, which checks
Rust format, Clippy, SQLCipher native tests and whether a reviewed lock
is present. If Cargo/MSVC, the existing script or the lock is missing,
**the command fails**, never claiming readiness.

For an explicitly partial check only (when Rust is not available):

```powershell
.\crates\encrypted-outbox-spike\validate-v3-windows.ps1 -ReferenceOnly
```

This returns success only for the Node reference gate and clearly
labels that result **REFERENCE-ONLY**. The script never installs a
toolchain, fetches packages automatically on its own, builds an
installer, modifies real data, deploys, merges or runs GitHub Actions.

## Actual validation performed in the authoring environment

- Node.js 22.16.0: the hardened runner's **14/14 contract tests PASS**.
  They cover mandatory discovery, missing SQL, missing suites, future
  suites, nonfile entries, Node version checks, real child test
  invocation, intentional failures, **empty test files, skipped/TODO
  tests, partially skipped suites, and one empty mandatory suite**.
  Empty-test files, skipped tests and TODOs were independently
  reproduced with Node's TAP reporter before fixing the false PASS.
- Earlier exact v3 SQLite request/queue/history/ACK suites were rerun
  against the matching local DDL and passed **50/50**.
- The new three tracked files were verified **byte-for-byte** against
  their GitHub blobs:
  - `tools/v3-sqlite-reference-gate.mjs`:
    `b1bb9c85bdc3091e202ebb1f5b78e620973fdfcd`
  - `tests/v3-reference-gate.test.mjs`:
    `3bcc10d363d8ecd7fdeed663e6b452e7da0f71db`
  - `crates/encrypted-outbox-spike/validate-v3-windows.ps1`:
    `ca3131d4dd116ff2a14f8dd85cee69cf50ea2fa2`

**Not executed here:** the complete 11-suite v3 aggregate on a
full checkout (some historical test files were not locally mounted),
the PowerShell wrapper, Rust/Cargo/rustfmt/Clippy, Windows MSVC,
native SQLCipher/HMAC, wrong-key refusal, crash recovery and encrypted
backup/restore. The runtime lacks Rust tooling and PowerShell.
No claim of a native/production-ready encrypted store is made.

Before merging, perform the full validation on the exact reviewed
stacked branch, check GitHub PR conflicts and each dependent base,
reconcile sibling backup PR #35's manual script changes, and review
whether historical strict v3 schema archives need a separate safe,
explicit migration. Never silently upgrade any real database.

No main merge, GitHub Actions, production, release, app IPC, licensing
or visibility change.
