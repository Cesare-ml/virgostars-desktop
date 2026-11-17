# Ephemeris data bundle and Windows installer

**Status: Locally tested (2026-11-17).** An NSIS installer was built and installed on a Windows 11 machine, started with no environment variables and drew the sky of the moment from the shipped data. It is **not signed** and **not published**.

## What the installer carries

| File (under the install folder) | Content | Size |
| --- | --- | --- |
| `ephemeris/de441-slice.eph` | JPL DE441, coefficient records for **1890 to 2110** only | 20.6 MB |
| `ephemeris/usno/*` | USNO ΔT data and predictions | 45 KB |
| `ephemeris/chiron.bsp` | JPL small-body SPK for Chiron (1900–2101) | 3.7 MB |
| `ephemeris/manifest.json` | file names, sizes, SHA-256 of the above | — |
| `places/`, private artwork | as in [Local full build](LOCAL_FULL_BUILD.md) | — |

The whole installer is about 122 MB, mostly the city catalog and artwork.

## The slice is the same data, not a re-computation

`scripts/ephemeris/slice-de441.mjs` copies the 8 144-byte coefficient records of 32 days each byte for byte and rewrites only the start and end dates in the header, so the engine's reader opens it as an ordinary, shorter file. No astronomy is done in the script. `--verify` compares every copied record with the full file, and the staging script runs it each time.

Checked on 2026-11-17: 404 requests through the native executable (fictional instants and places 1900–2033, including both ends) returned **byte-identical** responses with the full 2.8 GB file and with the slice. The 67 Rust tests also pass with the slice as the DE441 file.

## Producing an installer

The data stay outside the repository (`.local/` is git-ignored). From files you hold locally:

```powershell
node scripts/ephemeris/prepare-data-bundle.mjs <full-de441.eph> <usno-dir> <chiron.bsp> 1890 2110
npm run build:installer
```

`build:installer` builds the private-artwork UI and runs `tauri build --bundles nsis` with the city-catalog and ephemeris configuration overrides. It does not download anything and fails if a staged file is missing. The ordinary `build:ui` / `tauri:build` stay free of private material and data, so the public-source build still works without them (it then has no provider).

## Where the host looks

Environment variable, then `ephemeris.json`, then the shipped files ([provider](VIRGOSTARS_EPHEMERIS_PROVIDER.md)). Installing a full DE441 file later therefore needs only a path in `ephemeris.json`.

## Not done

- Code signing and the updater (SmartScreen will warn on an unsigned installer).
- A first-run download of the full 2.8 GB file; it needs a hosting decision and a signed manifest.
- Confirmation of the rights to redistribute each data file.
