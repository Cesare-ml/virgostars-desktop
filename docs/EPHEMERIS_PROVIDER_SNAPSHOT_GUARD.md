# Ephemeris provider snapshot guard

Status: **Prototype hardening; native tests not executed in this authoring environment**.

## Why

The versioned `calculate_chart` command already validates the UTC request before calling the injected `EphemerisProvider`. Its result was then forwarded to the WebView without a final native check. That left the transport boundary dependent on every current and future provider independently returning finite, normalized and reasonably bounded values.

## Change

`src-tauri/src/chart_calculation.rs` now validates a provider snapshot before returning `status: "ok"`:

- Julian day must be finite and positive.
- The body collection must be non-empty and bounded (64); house systems and unavailable-item lists are bounded too.
- Every angular coordinate must be finite and in its declared range: longitudes/right ascensions/house angles in [0, 360), latitudes/declinations in [-90, 90].
- Distances must be finite and positive; all three motion components must be finite.
- Body, house and unavailable identifiers/source labels must be short printable ASCII labels.
- Duplicate identifiers and an identifier being both available and unavailable are rejected.

Any provider error or malformed provider snapshot becomes the existing opaque `calculation_failed` response. No diagnostic, path or input is included in that response. No fallback provider is silently selected.

## What this proves — and does not prove

This is a **transport-shape and basic numeric plausibility guard only**. It does not prove that a provider:
- calculated the requested UTC instant or observer correctly;
- uses the expected coordinate origin, frame, ecliptic/equatorial conventions, precession/nutation, aberration or light-time model;
- uses authentic DE441 data, correct time scales or licensed/redistributable kernels;
- has accuracy matching Swiss Ephemeris, JPL Horizons or another independent reference.

The current optional Swiss provider remains a local-use prototype subject to its separate license conditions. The canonical VirgoStars-Ephemeris provider is not integrated or certified by this change. Scientific readiness still requires independent source provenance, matched conventions, cross-date/observer comparison and a documented error budget. The app must continue to display the real provider identity/source and unavailable items rather than inventing them.

## Tests added

Rust unit tests cover:
- non-finite and out-of-range coordinates;
- duplicate/contradictory body identifiers;
- excessive body counts and invalid source labels.

The test fixture now includes a visibly synthetic valid body so the normal success path can be exercised after the guard.

## Verification status

The repository's Rust toolchain is not available in the authoring runtime, so **no Cargo compilation or Rust test execution is claimed**. Before accepting this patch, run on a complete checkout:

```powershell
cd src-tauri
cargo fmt --check
cargo test --locked chart_calculation
cargo clippy --locked --all-targets -- -D warnings
```

Then run the complete Desktop `npm test`, `npm run build:ui`, and a Windows 11/Tauri/WebView2 smoke check with a synthetic fixture. Repeat the numerical comparison gates separately when integrating VirgoStars-Ephemeris. Never activate real personal chart records while the local archive is still plaintext.
