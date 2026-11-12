# Conflict pagination v3 — exact-schema regression gate

**Status: locally tested reference only. Not native Rust/SQLCipher.**
This draft branch is stacked on PR #39, which introduces bounded
v3 conflict keyset pagination in the isolated experimental Rust crate.

## Why this test is necessary

PR #39's original independent pagination reference used a minimal
`local_outbox` table. That is useful for FIFO cursor edge cases but
cannot exercise the real v3 DDL, including foreign-key relationships,
CHECK constraints, append-only decision history and the v3 trigger that
reserves previously used mutation IDs.

The new file is:

    tests/sqlite-v3-keyset-fullschema.test.mjs

It opens a **temporary plaintext SQLite database**, enables foreign
keys and applies the repo's v1, v2 and v3 schema files in order, then
checks `user_version=3` and an empty `foreign_key_check`.

It executes 10 test cases:

1. Exact three-schema initialization and foreign-key integrity.
2. Interleaved fictional profiles and pending edits, paged by FIFO.
3. An exactly full terminal page produces no phantom next cursor.
4. Deleting a previously viewed conflict does not duplicate or skip
   later FIFO entries.
5. Retiring a conflict between pages does not hide the next one.
6. Inserting a later conflict after reading a page is visible at its
   greater sequence on the following page.
7. Deleted/tombstone fictional subjects still paginate if conflicted.
8. Out-of-range, negative, fractional, unsafe cursors and invalid
   limits/profiles are rejected.
9. The real v3 SQLite trigger refuses a reinserted retired mutation ID.
10. Sixty deterministic interleaved fictional edits across two profiles,
    checked using page sizes 1, 2, 3, 7, 10 and 100 against exact FIFO
    expectations (no duplicate/omitted entries).

## Verification actually performed

Node.js **22.16.0** completed:

    node --experimental-sqlite --test tests/sqlite-v3-keyset-fullschema.test.mjs

**10/10 PASS.** Also ran these 10 together with the prior
`tests/sqlite-v3-conflict-previews.test.mjs` (10) and
`tests/sqlite-v3-keyset-pagination.test.mjs` (6):
**26/26 PASS**.

The new test Git blob on GitHub is byte-for-byte identical to the
locally executed source:

    aa7d7dd89aa14d72829969e4aaf25e8284303a3d

The previously executed two files also match their GitHub blobs:

    0f8c65af26c476549cf196e0bb3413898f12e737
    8839dc7c417acaa05f9560e2897cfb7e87b94bbe

The schema DDL blobs used locally, verified against GitHub:

    v1 013b80914fb2fc1bbb66ff266e7f7a069b96e794
    v2 306e343ff3f8e3e9637ee4111379ea5b8527c699
    v3 960f1894d0c592597451df779d4d3df783b0d140

These executable tests validate the *reference* SQL behavior and the
cursor query shape, **not execution of the Rust implementation**.

## Required native and integration gates

- Rust/Cargo/rustfmt/Clippy were **not** available in this environment.
  An attempted Rust toolchain download could not resolve
  `static.rust-lang.org`. None of the native SQLCipher tests or
  Windows MSVC builds has been executed here.
- Run the full Rust SQLCipher suite using a reviewed Cargo.lock
  and explicit Windows/MSVC/SQLCipher prerequisites before merging
  any of the stacked synthetic storage PRs.
- Validate full-schema encrypted cursor behavior, corruption/HMAC,
  backup/reopen and key ownership. A keyset cursor is not an
  authentication token; cross-page results are not a frozen snapshot.
- Keep SHA-256 original-request fingerprints private to the authorized
  storage layer. It is not a server signature or account proof.
- Avoid a simultaneous edit to the Windows validation script:
  sibling draft PR #35 already changes
  `crates/encrypted-outbox-spike/validate-windows.ps1`.
  Include this test in the consolidated manual gate only when merging
  and reviewing the entire stacked series.

No production records, GitHub Actions, deployment, main merge,
application IPC, public release or repository/license changes.
