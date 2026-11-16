# Return-search calendar boundary guard

Status: draft, unverified by Cargo in the authoring environment.

The return search promises a half-open UTC year `[January 1, next January 1)`. Previously its final sampling step evaluated the right endpoint and could include a crossing that occurred exactly at the start of the following year. That can duplicate a return between adjacent yearly searches.

The bracketing loop now excludes a crossing at `end` while retaining one that occurs just before `end`. It uses the unrounded native offsets, not formatted UTC milliseconds, to decide which year owns the event.

Two new deterministic unit tests use a uniform synthetic longitude function to cover the exact endpoint and a crossing one second before it. They are not astronomical accuracy tests.

## Manual verification before merge

```powershell
cd src-tauri
cargo fmt --check
cargo test --locked return_search
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --features swiss-ephemeris return_search
```

Then run a Windows Tauri smoke test of the native returns UI, including consecutive years. No build, test or native GUI execution was performed as part of this draft. No dependency, API, feature flag, GitHub Actions, release or distribution change.
