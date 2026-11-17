# Swiss Ephemeris source-consistency guard

Status: draft, source-only change. Native Cargo tests have not been executed in the authoring environment.

The temporary Swiss adapter previously labelled a successful response as `jpl` whenever neither the Moshier nor Swiss-files bit was present. That was not evidence of JPL usage. It also combined ecliptic and equatorial outputs without checking whether the two calls used the same underlying ephemeris.

The adapter now accepts only one unambiguous ephemeris flag (`SEFLG_MOSEPH`, `SEFLG_SWIEPH` or `SEFLG_JPLEPH`). Unknown, missing or mixed source bits are rejected. A body is unavailable when its ecliptic and equatorial calls disagree about the source; its position is never silently mixed. The Sun/Moon return-search longitude similarly requires an identified source and a normalized finite longitude. This is especially relevant when a requested Swiss file is missing and the C library can fall back to Moshier: a consistent fallback may still be reported under its actual name, but an unknown or contradictory provenance cannot be labelled as JPL.

Two focused Rust tests cover the source-bit matrix and cross-coordinate agreement. Existing Swiss numerical and polar-house tests must be rerun.

This is a provenance consistency check, **not** a scientific accuracy certification or a proof of JPL kernel authenticity. It does not activate the canonical VirgoStars-Ephemeris provider, alter the default feature-off build, modify Tauri IPC, add dependencies or distribute Swiss code.

## Manual validation before merge

From a licensed/local-only developer checkout:

```powershell
cd src-tauri
cargo fmt --check
cargo test --locked --features swiss-ephemeris swiss_provider
cargo clippy --locked --features swiss-ephemeris --all-targets -- -D warnings
```

Then run full Desktop tests and native Windows smoke with a real Swiss response and a deliberately missing Swiss-file directory, checking the returned source label. Do not distribute a Swiss-linked binary without a separately approved licensing decision. No GitHub Actions or automatic deployment.
