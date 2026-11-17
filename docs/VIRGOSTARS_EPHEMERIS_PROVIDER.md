# VirgoStars-Ephemeris provider

**Status: Integrated in the host, locally tested (2026-11-17).** Not released: no installer exists and the data files are not distributed (see "What blocks a public installer"). Real astronomy now comes from the canonical Rust engine; the temporary Swiss Ephemeris adapter has been removed from the build.

## What it does

- `src-tauri/src/virgostars_provider.rs` implements the `EphemerisProvider` port with `virgostars-ephemeris-core` (CPAL-1.0), pinned to one reviewed commit (`6835e00`) of `Cesare-ml/VirgoStars-Ephemeris`. The git dependency needs network access the first time it is fetched.
- `calculate_chart` v1 is unchanged (same IPC contract, no path, name or account data crosses it). It now answers with provider id `virgostars_ephemeris`, source `jpl` and the engine version string.
- Bodies: Sun, Moon, Mercury, Venus, Mars–Pluto, mean and true lunar Node, mean and osculating Apogee, and Chiron (JPL SPK, NAIF 20002060). Apparent geocentric ecliptic-of-date positions, speeds, right ascension and declination.
- Mars to Pluto are the **system barycentres** (the usual convention for the outer planets, DE441 carries no separate body for them).
- Houses (`src-tauri/src/houses.rs`): Vehlow ("egizia"), Placidus, Koch, Regiomontanus and Porphyry, ported from the `astrological-functions` reference (`feat/houses-reference-validation-20261116`) and tested against its JavaScript output to 1e-8°. Ascendant, Midheaven and ARMC come from the engine. At polar latitudes the systems that do not exist are listed as unavailable; nothing is substituted.

## Data the user supplies

Nothing astronomical ships in this repository or in a build. The host looks for three local items and never exposes their paths to the WebView:

| Item | Environment variable | `ephemeris.json` key | Needed |
| --- | --- | --- | --- |
| Classic JPL DE441 binary (about 2.8 GB) | `VIRGOSTARS_DE441_PATH` | `de441` | yes |
| USNO ΔT folder (`deltat.data`, `historic_deltat.data`, `deltat.preds`) | `VIRGOSTARS_USNO_DIR` | `usnoDirectory` | for dates after 27 June 2027 |
| Chiron SPK (`2060_chiron_1900_2101.bsp`, about 3.7 MB) | `VIRGOSTARS_CHIRON_SPK` | `chironSpk` | for Chiron |

`ephemeris.json` lives in the application's local data folder (`%LOCALAPPDATA%\<identifier>`), is limited to 16 KiB, and unknown keys make it invalid. Environment variables win over the file. Without a DE441 file there is **no provider**: the command answers `provider_unavailable` and the interface says the data file was not found (no fake astronomy, no fallback).

Example:

```json
{ "de441": "D:/data/de441.eph", "usnoDirectory": "D:/data/usno", "chironSpk": "D:/data/2060_chiron_1900_2101.bsp" }
```

## Supported dates

- The app accepts calendar years **1900 to 2100**. This is the range the engine's time policy was validated for; dates before 1900 are refused (`invalid_request`). Earlier versions accepted years 0 to 5000 through the Moshier ephemeris; that range is gone and is a goal for later, after the long-term path is validated.
- The real upper limit is lower. Terrestrial time needs ΔT: the measured values plus the USNO **predictions** end in 2033, so with the USNO folder the engine answers up to about **2033** and `out_of_range` after that. Without the folder the limit is **27 June 2027** (the built-in civil-time policy). The interface explains this with `calc.range`; the engine, not the desktop, owns ΔT, and no extrapolation was added here.

## Verification (2026-11-17, Windows)

- `cargo test --locked`: 65 unit tests pass with the real data files configured; without them the provider tests skip themselves. `npm test`: 882 pass.
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
- Edge dates through IPC: 1899 and 2101 are refused as invalid, 1900-01-01 to 2030 answer with 15 bodies, 2035 and later answer `out_of_range`; with no DE441 path the answer is `provider_unavailable`.

## What blocks a public installer

These are maintainer decisions and are **not** done here:

1. **Data distribution.** DE441 is 2.8 GB and cannot ship inside an installer. Options: the user downloads or supplies it (first-run instructions), or a trimmed 1900–2100 slice is built (not attempted; the reader's acceptance of a trimmed file is unverified). The USNO files and the Chiron SPK are small but each needs its distribution rights assessed ([Licensing and publication](LICENSING_AND_PUBLICATION.md)).
2. **Date coverage after 2033** needs an engine-side decision on ΔT beyond the predictions.
3. **Identity.** The product is still "VirgoStars Desktop Lab" with synthetic icons, version 0.0.1; changing the bundle identifier changes the application-data folder and the credential-store entry of the encrypted archive.
4. **Signing and updates.** There is no code-signing certificate (an unsigned installer triggers SmartScreen) and no updater with signature validation.
5. The engine's own documents still call it experimental; no release acceptance has been run.

## Rollback

The adapter sits behind the port. Removing the `virgostars-ephemeris` default feature returns the build to "no provider" and the labelled synthetic chart.
