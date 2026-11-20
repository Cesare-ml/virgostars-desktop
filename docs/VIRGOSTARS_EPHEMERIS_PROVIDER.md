# VirgoStars-Ephemeris provider

**Status: Integrated in the host, locally tested (2026-11-17).** Not released. An unsigned installer that ships a 1890–2110 data slice has been built and tested locally ([data bundle](EPHEMERIS_DATA_BUNDLE.md)); the full 2.8 GB file is not distributed (see "What is still open for a wider release"). Real astronomy now comes from the canonical Rust engine; the temporary Swiss Ephemeris adapter has been removed from the build.

## What it does

- This draft pins `virgostars-ephemeris-core` to `8e4b44f56a2e425e3427ffdc09e68d80fe9f31b2` from the unmerged [Ephemeris PR #651](https://github.com/Cesare-ml/VirgoStars-Ephemeris/pull/651). The existing chart adapter still uses a single DE441 file; this pin does not activate multipack calculation. The dependency needs network access the first time it is fetched.

The normal new-chart form has an opt-in **historical date** mode. A separate
versioned Tauri command sends the chosen Julian/proleptic Gregorian calendar,
local-mean-solar or supplied local-minus-UT1 offset, ΔT source and explicit
uncertainties to the historical provider. It maps ten planets and four lunar
points and reuses the five existing Desktop house methods; the resulting chart
is rendered and may be saved and reopened. Lunar model points use the distinct
`lunar_model` source label. Chiron is unavailable in this path. Solar events
remain available at the provider layer but are not requested by this form.

The requested civil year range is astronomical −12999..3999, conditional on
the actual DE441 file's coverage. The built-in Espenak–Meeus model covers only
−1999..3000; outside that interval the user must supply ΔT. Local mean solar
time is a chosen convention, not an automatic historical timezone lookup. No
UTC instant is fabricated; the modern chart path remains unchanged. The sky
navigator can also calculate dates outside 1900–2033 through the historical
provider, using the reference city's IANA clock rules and an Espenak–Meeus
estimate with unquantified uncertainty. IANA rules may be extrapolated for
ancient dates and do not establish historically accurate civil time. The
automatic navigator supports years 1–3000 subject to installed DE441 coverage;
its estimated historical results remain session-only and cannot be archived.
The explicit historical form retains its separate input contract. This is an
experimental local implementation, not a release.
- `calculate_chart` v1 is unchanged (same IPC contract, no path, name or account data crosses it). It now answers with provider id `virgostars_ephemeris`, source `jpl` and the engine version string.
- Bodies: Sun, Moon, Mercury, Venus, Mars–Pluto, mean and true lunar Node, mean and osculating Apogee, and Chiron (JPL SPK, NAIF 20002060). Apparent geocentric ecliptic-of-date positions, speeds, right ascension and declination.
- Mars to Pluto are the **system barycentres** (the usual convention for the outer planets, DE441 carries no separate body for them).
- Houses (`src-tauri/src/houses.rs`): Vehlow ("egizia"), Placidus, Koch, Regiomontanus and Porphyry, ported from the `astrological-functions` reference (`feat/houses-reference-validation-20261116`) and tested against its JavaScript output to 1e-8°. Ascendant, Midheaven and ARMC come from the engine. At polar latitudes the systems that do not exist are listed as unavailable; nothing is substituted.

## Where the data come from

Nothing astronomical is committed to this repository. The host looks for each of three items, in this order: an environment variable, `ephemeris.json` in the application's local data folder, then the files shipped inside the installer ([data bundle](EPHEMERIS_DATA_BUNDLE.md)). Paths never cross IPC.

| Item | Environment variable | `ephemeris.json` key | Shipped name |
| --- | --- | --- | --- |
| Classic JPL DE441 binary | `VIRGOSTARS_DE441_PATH` | `de441` | `ephemeris/de441-slice.eph` (last smoke-tested 1890–2110, 20.6 MB; next private staging default 1000–2200, untested) |
| USNO ΔT folder (`deltat.data`, `historic_deltat.data`, `deltat.preds`) | `VIRGOSTARS_USNO_DIR` | `usnoDirectory` | `ephemeris/usno/` |
| Chiron SPK (NAIF 20002060, 3.7 MB) | `VIRGOSTARS_CHIRON_SPK` | `chironSpk` | `ephemeris/chiron.bsp` |

`ephemeris.json` lives in `%LOCALAPPDATA%\<identifier>`, is limited to 16 KiB, and unknown keys make it invalid. A user-named full DE441 file therefore replaces the shipped slice with no other change. With no DE441 file at all there is **no provider**: the command answers `provider_unavailable` and the interface says the data file was not found (no fake astronomy, no fallback).

## Supported dates

- The modern UTC chart flow accepts calendar years **1900 to 2033**. Terrestrial time needs ΔT, and the USNO measured values plus predictions end in autumn 2033, so the last months of 2033 can still answer `out_of_range`. The separate opt-in historical flow is described above and requires an explicit time convention and ΔT choice.
- Without the USNO folder the engine's own limit is **27 June 2027**.
- Earlier versions accepted years 0 to 5000 through the Moshier ephemeris. That range is a goal for later: it needs the full DE441 file **and** a validated long-term ΔT model in the engine, which do not exist yet.

## Experimental historical planet bridge (2026-11-18)

**Product direction:** the technical historical-planets panel is no longer exposed in Desktop. The native diagnostic commands remain available for development. The planned user-facing ephemeris navigator is described in [the ephemeris navigation proposal](EPHEMERIS_NAVIGATION_TODO.md).

The panel descriptions and WebView smoke instructions below record earlier prototype behavior; the panel is no longer accessible in the current shell and that panel-specific smoke is no longer a current acceptance check.

`calculate_historical_planet` is a separate v1 native command, with a TypeScript adapter in `src/app/native/historical-planets.ts`. It requires a body, an already-known Julian day **UT1**, TT−UT1 in seconds, its nonnegative uncertainty, and a nonempty source label. An uncertainty of zero is a caller assertion, not a proof of accuracy. TT-to-TDB uses the engine's approximation, and the returned uncertainty is not an angular error bound.

The separate `calculate_historical_planet_calendar` command and the **Historical planets · experimental** Desktop panel accept a proleptic Gregorian date and time already expressed in UT1, with astronomical year numbering, for years −12999 through 3999. The panel can calculate one body or the Sun, Moon and eight other supported bodies for the same instant; it does not extend `calculate_chart` or create a historical chart. For the set it calls the existing native command sequentially, verifies consistent time/source metadata and displays no partial set if a body fails. Editing inputs or closing the component cancels the remaining requests and suppresses stale results. Users may supply ΔT and a source themselves or explicitly select the Espenak–Meeus 2006 estimate for astronomical years −1999–3000. An uncertainty must be supplied, except when the user explicitly selects the separately attributed Morrison–Stephenson 2004 standard-error estimate within its narrower decimal-year range [−999, 1200]. The latter is a 1σ model estimate, not a guaranteed bound, and applying it to the chosen ΔT is an assumption. For 2005 onwards the 2006 publication used historical projections, not current measurements. The native host uses the core's calendar conversion and derives the model's decimal year from the same UT1 date. No UTC, time zone, local civil-time or historical clock conversion is inferred. The separate modern chart policy is unchanged.

The panel accepts fractional UT1 seconds from 0 inclusive to 60 exclusive. Entering more decimal places does not imply that the input or historical Earth rotation is known to that precision; the Julian-day representation also limits numerical resolution. Leap seconds and UTC conversion are not supported by this input.

The result includes time provenance and apparent planet position with experimental empirical longitude, latitude and radial speeds per TDB day. These candidate speeds are not derivatives of the returned position. Radial correction is explicitly indicated and is not applied to the Sun. Mars–Pluto refer to system barycentres. It does not calculate houses, lunar nodes/apogees, Chiron or stars. No data path crosses IPC and no network request is made. Provider absence and calculation failure are reported, not substituted. The actual selected DE441 file controls date coverage; the shipped slice does **not** cover the desired 13000 BCE–3999 CE range.

The optional `includeScenarios` flag also asks the core for positions at ΔT minus and plus the declared uncertainty, holding UT1 fixed. The panel displays both samples and their ΔT values; the nominal position remains separate. These three samples are not guaranteed bounds, a confidence interval, or a prediction of physical timing accuracy. The direct-obliquity frame must agree with the nominal candidate, and all three samples must succeed. An unrepresentably small nonzero perturbation or missing ephemeris coverage produces `calculation_failed` rather than partial or duplicated results. With the flag absent, the response and calculation remain unchanged.

**Historical source decision:** offer the bounded, opt-in core estimates above and otherwise require caller-supplied values. [NASA's Espenak–Meeus expressions](https://eclipse.gsfc.nasa.gov/LEcat5/deltatpoly.html) are presented for astronomical years −1999 to +3000; the [standard-error estimate](https://eclipse.gsfc.nasa.gov/SEhelp/uncertainty2004.html) covers a narrower historical interval. NASA also describes the [growing uncertainty of extrapolated ΔT](https://eclipse.gsfc.nasa.gov/SEhelp/rotation.html). These facts do not justify silently extending either model to 13000 BCE or 3999 CE.

The historical panel can also **explicitly** select the already configured local USNO-format table. The files' provenance and vintage are not authenticated. The caller supplies the uncertainty used for the sensitivity samples. The panel separately displays the table's source-reported error if available; its meaning is unverified and it is neither an interpolation bound nor automatically used as the caller's uncertainty. An absent source error stays absent: between table points the core reports one only when both endpoints provide it. Non-prediction entries are labelled as such rather than universally called observations, because they may include historical reconstructions. Predictions require a separate opt-in and are labelled as predictions. The published monthly table dates are UTC but the current core interprets those numeric dates as UT1; the effect of that approximation is not bounded here. Missing tables and dates outside the table (including disallowed predictions) have distinct errors and never fall back to another model. The chosen snapshot's coverage and freshness depend on its externally supplied files. This does not change the separate modern full-chart policy.

The Windows WebView2 and native USNO wiring tests used the pre-existing local snapshot with SHA-256 `7396fcfdad33856b5242f288887678d75f3803494fa79394bc02f37eb99efc1e` (`deltat.data`), `9f43514119060601a00624a5d9287a91b0b1f5e12bec5209bbabda90b392b70b` (`historic_deltat.data`) and `5d864fddd30b2c64d2a86d3debbb25604eb5de44370c96bccf2abd5463f3db08` (`deltat.preds`). These hashes identify the tested bytes, not publisher authenticity or forecast vintage.

The engine's existing Swiss comparisons and owner-approved thresholds are sampled results, not a guarantee over every epoch or historical physical accuracy. On Windows, the bridge was locally checked against the same core and the user-supplied full DE441 for Sun, Moon, Mercury and Pluto at three synthetic UT1 instants in 13000 BCE, 2000 and 3999 CE; the ΔT used for these was fictional and the test establishes adapter wiring, not independent astronomical validation. The same local test exercises the BCE calendar command with estimated uncertainty and samples. A WebView2 smoke using an isolated app identifier and synthetic inputs passed for a model result, an ancient explicit-source result and an astronomical year −500 result with the opted-in standard-error estimate. The frontend build used an explicitly supplied sibling charts path. This was not a packaged installer or installation test.

For a repeatable local smoke, first prepare the synthetic Angular build, set `VIRGOSTARS_DE441_PATH` to a separately obtained full DE441, then build with a **separate test identifier** and embedded assets. From the repository root on Windows:

```powershell
$env:CARGO_TARGET_DIR = "$PWD\.local\target"
$env:TAURI_CONFIG = '{"identifier":"it.virgostars.historicalqa"}'
cargo build --manifest-path src-tauri/Cargo.toml --locked --release --features tauri/custom-protocol
node scripts/smoke-historical-webview.mjs
Remove-Item Env:TAURI_CONFIG
```

The smoke refuses a binary without the test identifier, opens an isolated WebView profile under ignored `.local`, uses only synthetic inputs and a loopback debugger, and terminates the test application. Set `VIRGOSTARS_HISTORICAL_SMOKE_USNO_DIR` to an existing local USNO directory to additionally test the USNO path; without it the USNO case is explicitly skipped. The profile is retained locally. A previous bare `cargo build --release` omitted `tauri/custom-protocol` and loaded the development-server URL instead of embedded assets; it did not verify the UI.

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

1. **Full DE441 (2.8 GB) for the desired historical interval.** Hosting, a signed download manifest, a suitable automatic long-term ΔT source and historical civil-time handling are not done. The installer ships a 1890–2110 slice instead. The explicit UT1 command above is an integration building block, not a solution to historical chart input.
2. **Rights of the shipped data** (DE441 slice, USNO files, Chiron SPK) must be confirmed by the maintainer before publication ([Licensing and publication](LICENSING_AND_PUBLICATION.md)).
3. **Identity.** The product is still "VirgoStars Desktop Lab" with synthetic-derived icons, version 0.0.1; changing the bundle identifier changes the application-data folder and the credential-store entry of the encrypted archive.
4. **Signing and updates.** There is no code-signing certificate (an unsigned installer triggers SmartScreen) and no updater with signature validation.
5. The engine's own documents still call it experimental; no release acceptance has been run.

## Rollback

The adapter sits behind the port. Removing the `virgostars-ephemeris` default feature returns the build to "no provider" and the labelled synthetic chart.
