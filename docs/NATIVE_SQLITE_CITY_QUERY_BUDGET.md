# Native offline city-search SQLite execution budget

**Status: proposed native prototype safeguard.** Rust/Tauri compilation and
Windows WebView2 verification have not been performed for this branch.

## Motivation

The local `search_offline_places` command allows at most two simultaneous
blocking SQLite jobs. The Angular client can give up waiting (for example,
the 5-second UI IPC deadline in pending draft PR #165), but a timed-out
JavaScript Promise does **not** cancel a Rust `spawn_blocking` worker.
A malformed database or expensive FTS5 query could therefore keep both
native worker slots occupied.

## Proposed behavior

- Retain one read-only SQLite connection per search, fixed resource path,
  `query_only` and maximum two active queries.
- Enable rusqlite 0.32's existing `hooks` feature alongside `bundled`.
  No new crate is deliberately introduced.
- Configure a per-connection SQLite VM progress callback, checked every
  approximately **1,000 virtual machine operations**. When `Instant::now()`
  reaches the **4-second native budget**, SQLite interrupts the running
  statement. The command returns a sanitized `PLACE_QUERY_TIMEOUT` error
  code rather than SQL/OS exception details.
- Bound the SQLite lock-wait timeout to **1 second**, shorter than the native
  budget. This protects a different failure mode from long-running SQL
  computation.
- `QueryPermit` stays scoped inside the blocking closure. It is released by
  RAII once native work finishes, including after an interrupted query.
- Existing Angular error handling classifies the unrecognized
  `PLACE_QUERY_TIMEOUT` as `unavailable`; no new privileged IPC, permission
  or UI label is required. A future explicit localized timeout state can be
  reviewed independently.

This is a **cooperative SQLite work bound**, not a hard wall-clock interrupt:
the progress callback cannot stop arbitrary filesystem stalls outside
SQLite's VM or an individual SQLite opcode that never returns. The native
deadline begins once the resource connection has opened; the client-side
deadline, if later merged, applies to the whole IPC request.

## Review and verification

Rust unit tests added to `src-tauri/src/offline_places.rs` exercise a
successful short query and force interruption of a long read-only recursive
query by supplying an already-expired deadline. Node source-contract tests
in `tests/native-place-deadline-source.test.mjs` check reviewed constants,
progress callback setup, IPC error boundaries and retained read-only gating.

In an authorized development checkout, run:

```sh
node --experimental-strip-types --test tests/native-place-deadline-source.test.mjs
npm test
cd src-tauri
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
```

Then test a packaged, licensed city database under real Windows WebView2:
common two-character prefixes, Unicode city names, absence/corruption of the
resource, concurrent searches, disabled network and recovery after a slow
query. Record actual latency and SQLite worker occupancy on realistic
catalogs before deciding whether 4 seconds is a suitable production limit.

## Integration and scope

Draft PR #165 currently adds a **5-second UI deadline** but does not cancel
native work. This native budget is independently useful and should be
reviewed together with that client-side contract before a merge.
The `hooks` feature may affect the dependency feature graph, so reviewers
must run `cargo test --locked` and review the existing lockfile; this PR
has **not** regenerated `Cargo.lock`.

No real user records, authenticated API, network access, encryption,
DB migrations, released catalog files, scientific calculations,
production infrastructure, GitHub Actions, signed installer, public
repository visibility or direct merge to `main` is changed.
