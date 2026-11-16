# Chart IPC coordinate overflow guard

The `calculate_chart` request accepts signed 32-bit integer latitude and longitude in microdegrees. Previously validation used `i32::abs()` to check both coordinates. On `i32::MIN`, `abs()` can overflow and panic in debug builds before returning `invalid_request`.

The validator now uses inclusive signed range checks (`[-90_000_000, 90_000_000]` latitude, `[-180_000_000, 180_000_000]` longitude) without absolute value. All out-of-range values, including `i32::MIN` and `i32::MAX`, return `invalid_request` before the provider is invoked. Legal boundary coordinates remain accepted.

A Rust unit test covers each extreme input and both valid bounds. This change does not alter the request or response schema or any astronomical calculation.

## Required verification

Run `cargo fmt --check`, `cargo test --locked chart_calculation`, and `cargo clippy --locked --all-targets -- -D warnings` from `src-tauri`, then check the Windows Tauri IPC path. No Rust tests or Windows builds were executed during this draft.
