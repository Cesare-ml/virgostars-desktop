# VirgoStars-Ephemeris provider

**Status: Integrated in the host, locally tested (2026-11-17).** Not released. An unsigned installer that ships a 1890–2110 data slice has been built and tested locally ([data bundle](EPHEMERIS_DATA_BUNDLE.md)); the full 2.8 GB file is not distributed (see "What is still open for a wider release"). Real astronomy now comes from the canonical Rust engine; the temporary Swiss Ephemeris adapter has been removed from the build.

## What it does

- `src-tauri/src/virgostars_provider.rs` implements the `EphemerisProvider` port with `virgostars-ephemeris-core` (CPAL-1.0), pinned to one reviewed commit (`6835e00`) of `Cesare-ml/VirgoStars-Ephemeris`. The git dependency needs network access the first time it is fetched.
- `calculate_chart` v1 is unchanged (same IPC contract, no path, name or account data crosses it). It now answers with provider id `virgostars_ephemeris`, source `jpl` and the engine version string.
- Bodies: Sun, Moon, Mercury, Venus, Mars–Pluto, mean and true lunar Node, mean and osculating Apogee, and Chiron (JPL SPK, NAIF 20002060). Apparent geocentric ecliptic-of-date positions, speeds, right ascension and declination.
- Mars to Pluto are the **system barycentres** (the usual convention for the outer planets, DE441 carries no separate body for them).
- Houses (`src-tauri/src/houses.rs`): Vehlow ("egizia"), Placidus, Koch, Regiomontanus and Porphyry, ported from the `astrological-functions` reference (`feat/houses-reference-validation-20261116`) and tested against its JavaScript output to 1e-8°. Ascendant, Midheaven and ARMC come from the engine. At polar latitudes the systems that do not exist are listed as unavailable; nothing is substituted.

## Where the data come from

Nothing astronomical is committed to this repository. The host looks for each of three items, in this order: an environment variable, `ephemeris.json` in the application's local data folder, then the files shipped inside the installer ([data bundle](EPHEMERIS_DATA_BUNDLE.md)). Paths never cross IPC.

| Item | Environment variable | `ephemeris.json` key | Shipped name |
| --- | --- | --- | --- |
| Classic JPL DE441 binary | `VIRGOSTARS_DE441_PATH` | `de441` | `ephemeris/de441-slice.eph` (years 1890–2110, 20.6 MB) |
| USNO ΔT folder (`deltat.data`, `historic_deltat.data`, `deltat.preds`) | `VIRGOSTARS_USNO_DIR` | `usnoDirectory` | `ephemeris/usno/` |
| Chiron SPK (NAIF 20002060, 3.7 MB) | `VIRGOSTARS_CHIRON_SPK` | `chironSpk` | `ephemeris/chiron.bsp` |

`ephemeris.json` lives in `%LOCALAPPDATA%\<identifier>`, is limited to 16 KiB, and unknown keys make it invalid. A user-named full DE441 file therefore replaces the shipped slice with no other change. With no DE441 file at all there is **no provider**: the command answers `provider_unavailable` and the interface says the data file was not found (no fake astronomy, no fallback).

## Supported dates

- The app accepts calendar years **1900 to 2033**. Terrestrial time needs ΔT, and the USNO measured values plus predictions end in autumn 2033, so the last months of 2033 can still answer `out_of_range` (the interface says so). Dates before 1900 are refused (`invalid_request`). The engine, not the desktop, owns ΔT, and no extrapolation was added here.
- Without the USNO folder the engine's own limit is **27 June 2027**.
- Earlier versions accepted years 0 to 5000 through the Moshier ephemeris. That range is a goal for later: it needs the full DE441 file **and** a validated long-term ΔT model in the engine, which do not exist yet.

## Verification (2026-11-17, Windows)

- `cargo test --locked`: 67 unit tests pass with the real data files configured; without them the provider tests skip themselves. `npm test`: 882 pass.
- Native executable driven through the WebView2 DevTools port with 300 synthetic requests (fictional instants 1900–2026 and places between 60° N and 60° S), compared with the earlier Swiss-linked build of the same app (local reference only, no Swiss output stored in the repository):

| Quantity | Mean difference | Maximum |
| --- | --- | --- |
| Sun, Mercury, Venus, Mars | 0.02–0.08″ | 0.72″ |
| Moon | 0.58″ | 2.9″ |
| Jupiter–Pluto | 0.12–0.28″ | 0.8″ |
| Mean Node, mean Apogee | 0.07–0.09″ | 0.22″ |
| Ascendant, Midheaven, all cusps (five systems) | 0.002″ | 0.008″ |
| true Node | 8.8″ | 33.6″ |
| osculating Apogee | 51.5″ | 222.7″ |

  True Node and osculating Apogee are defined differently by the two engines (osculating elements of the geocentric Moon), so a gap of that size is expected rather than an error. Chiron was unavailable in the reference build and is calculated here. The known conventions that differ on purpose (barycentre light-time, Swiss's Regiomontanus Midheaven-on-cusp-4 quirk) did not occur in this sample.
- Edge dates through IPC (before the range was set to 2033): 1899 and 2101 are refused as invalid, 1900-01-01 to 2030 answer with 15 bodies, 2035 and later answer `out_of_range`; with no DE441 path the answer is `provider_unavailable`.

## What is still open for a wider release

1. **Full DE441 (2.8 GB) for years 0–5000.** Hosting, a signed download manifest and the engine-side long-term ΔT are not done. The installer ships a 1890–2110 slice instead.
2. **Rights of the shipped data** (DE441 slice, USNO files, Chiron SPK) must be confirmed by the maintainer before publication ([Licensing and publication](LICENSING_AND_PUBLICATION.md)).
3. **Identity.** The product is still "VirgoStars Desktop Lab" with synthetic-derived icons, version 0.0.1; changing the bundle identifier changes the application-data folder and the credential-store entry of the encrypted archive.
4. **Signing and updates.** There is no code-signing certificate (an unsigned installer triggers SmartScreen) and no updater with signature validation.
5. The engine's own documents still call it experimental; no release acceptance has been run.

## Rollback

The adapter sits behind the port. Removing the `virgostars-ephemeris` default feature returns the build to "no provider" and the labelled synthetic chart.
