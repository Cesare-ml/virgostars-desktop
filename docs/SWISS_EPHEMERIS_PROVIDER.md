# Temporary Swiss Ephemeris provider and chart-calculation command

**Status: Prototype / locally tested (2026-11-15).** Not integrated on `main`, not released. It stands in until VirgoStars-Ephemeris is validated, behind the same `EphemerisProvider` port.

## What it does

- Rust command `chart_calculation::calculate_chart` (third reviewed IPC command). Input: protocol version, one UTC instant, latitude and longitude in micro-degrees. Output: apparent geocentric positions of Sun–Pluto, mean/true node, mean/osculating apogee, Chiron when data allows, and five house systems (`egizia` = Swiss `V`, `placido`, `koch`, `regio-montano`, `porfirio`).
- No file path, name or account data crosses IPC. Nothing is stored or logged. Charts live in WebView memory for the session only.
- **Date range.** The app accepts calendar years 0 to 5000. The built-in Moshier ephemeris calculates roughly 3000 BC to **28 April 3003** (Swiss `MOSHPLEPH_END`, JD 2 818 000.5); later dates are answered `out_of_range` ("beyond the range the current calculation engine can calculate") instead of a failure, and the interface keeps the chart it has. Swiss `.se1` files, when configured, are not subject to that limit here. Checked natively: calculations succeed from year 0 through 28 April 3003 and fail after it.
- Anything not computable is listed as unavailable (Chiron with the built-in Moshier ephemeris; Placidus and Koch near the poles). Nothing is substituted.
- The default build has **no provider**: the command answers `provider_unavailable` and the UI keeps the labelled synthetic fixture.

## Building with the provider

```powershell
cd src-tauri
cargo test --features swiss-ephemeris
cargo run --features swiss-ephemeris
```

Optional higher-precision data: set the local environment variable `VIRGOSTARS_EPHE_PATH` to a directory of Swiss `.se1` files before starting the app. Without it the built-in Moshier ephemeris is used and reported as such in the UI. Never commit ephemeris files.

## Licensing — blocking for distribution

Swiss Ephemeris and the `sweph-sys` crate are **AGPL-3.0** (or a paid Astrodienst professional licence). This repository is CPAL-1.0. A binary built with `--features swiss-ephemeris` links AGPL code, so it must not be distributed until the maintainer either holds a Swiss Ephemeris professional licence covering it or accepts AGPL terms for that binary. The feature is off by default so the public source build is unaffected. This is an engineering note, not legal advice.

**Maintainer decision, 2026-11-15:** no professional licence is held. The provider is for **local use on the maintainer's own machine only**. Do not publish, attach to a release or hand to anyone a binary built with `swiss-ephemeris`, and do not enable the feature by default.

## Other open points

- `astrological-functions` is now a required sibling checkout (`file:../astrological-functions`). The maintainer made that repository public on 2026-11-15; its README still says "private" and should be updated there.
- Austral inversion, lots (Tyche, Daimon…), aspects tables and every entry marked "planned" in `src/app/function-catalog.ts` are not implemented.
- Fisiognomica and Chakra are in the Regolo menu but excluded by the feature scope approved on 2026-11-10; they are listed as excluded pending a maintainer decision.
- `docs/NATIVE_IPC_INVENTORY.md`, `README.md` and `docs/ROADMAP.md` still describe two commands and no calculation: update them in the same PR.

## Verification on 2026-11-15 (Windows 11, Rust 1.99.1, Node 22.18.0)

- `cargo test`: 16 passed. `cargo test --features swiss-ephemeris`: 21 passed, including an independent J2000 Sun check.
- `npm test`: 771 passed, 12 skipped, 6 failed; the same 6 fail on `main` before this change.
- `npm run verify:ipc`, `verify:translations`, `verify-npm-lock`, `ng build desktop`, `verify:bundle`: passed.
- Browser preview with a mocked bridge returning a captured real provider response: form, natal wheel, planets, houses and transits flow rendered without console errors.
- Native Windows release build with `--features swiss-ephemeris`, inspected through WebView2's local DevTools port: the real command returned J2000 positions (Sun 280.3689°, Moon 223.3238°, Moshier), a malformed request returned `invalid_request`, and the form produced a natal chart, a transit ring, a synastry of two fictional charts and a Placidus house change, each ending in "chart ready" with no renderer error. Run once with synthetic assets and once with the approved private artwork (1013 files verified).
- **Not done:** PNG export of a calculated chart, a manual click-through by a person, Swiss `.se1` files via `VIRGOSTARS_EPHE_PATH`, comparison of positions against an independent ephemeris beyond the J2000 Sun.

## Running it locally

From a normal checkout (siblings `astrological-charts`, `astrological-functions` and, for real glyphs, `astrological-assets`):

```powershell
npm run tauri:build:swiss:private:local
```

or `npm run tauri:build:swiss:local` for the synthetic placeholder images. To include the offline city catalog as well (no installer is produced):

```powershell
npm run tauri:build:places:swiss:private:local
```

The plain builds above do not package the catalog, so the city search answers "catalog not installed" and coordinates must be typed. With the catalog build, city search and the picker were verified in the native window on 2026-11-15. The executable is `src-tauri/target/release/virgostars-desktop-spike.exe`. The `…:local` scripts exist for the maintainer's machine only.
