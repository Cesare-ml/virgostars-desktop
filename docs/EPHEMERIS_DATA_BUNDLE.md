# Ephemeris data bundle and Windows installer

**2026-11-20 event archive:** Windows and macOS installer preparation now
includes the pinned recorded-event archive under `ephemeris/events/`; the
owner requested its inclusion in Desktop installations. The file hash and all
blocks are checked before use. This is local integration, not a claim that an
installer was published or that all astronomical dates have complete data.

**Update, 2026-11-19:** a private, unsigned installer with the 1000–2200
base and multipack runtime has since been built and tested locally. The
Desktop data release is published separately. The build now stages the
reviewed DE441 catalog, checks its pinned SHA-256 and the exact base hash, and
embeds the pin at compile time. A larger or otherwise different local base
does not satisfy this release catalog. The installer contains other private
materials and is not thereby approved for public distribution. See
[the runtime candidate](DE441_MULTIPACK_RUNTIME_CANDIDATE_2026-11-19.md)
for verification and limitations. Earlier status statements below are retained
as historical checkpoints.

The staging slicer treats the requested end as exclusive and does not include
an additional coefficient record. With the verified JPL source, the ordinary
staging command reproduces the 111,662,384-byte catalog base exactly; an extra
record would be rejected by the catalog hash check.

**Status: Locally tested (2026-11-17).** An NSIS installer was built and installed on a Windows 11 machine, started with no environment variables and drew the sky of the moment from the shipped data. It is **not signed** and **not published**.

On 2026-11-18 an updated private NSIS installer was built with the local
738-star catalogue embedded in the executable and the previously staged 1890–2110
ephemeris files rechecked against their manifest. The corresponding executable
was smoke-tested locally, but this new installer has not been installed or
independently inspected. The embedded catalogue includes owner-supplied
third-party interpretation material; this private installer is not cleared for
redistribution. Do not describe it as signed, published, or fully validated.

**New proposed base (2026-11-19):** the *staging script's default* has moved to
**1000–2200 inclusive**, as requested for Desktop. A private Rust-exported
base of 111,662,384 bytes has since been generated and compared with its
local source, but has **not been tested in an installer**. The v2 staging manifest records
the requested years and the release preflight rejects the previous 1890–2110
bundle as an insufficient base. An existing private installer does not update
by itself. Optional downloadable ranges and the public catalog remain future
work; see [Ephemeris catalog PR #649](https://github.com/Cesare-ml/VirgoStars-Ephemeris/pull/649).

## What the installer carries

| File (under the install folder) | Content | Size |
| --- | --- | --- |
| `ephemeris/de441-slice.eph` | JPL DE441, **last installer-tested** slice 1890–2110; **next staging default** 1000–2200 | 20.6 MB old build; 111,662,384 bytes for the private Rust-exported base |
| `ephemeris/usno/*` | USNO ΔT data and predictions | 45 KB |
| `ephemeris/chiron.bsp` | JPL small-body SPK for Chiron (1900–2101) | 3.7 MB |
| `ephemeris/manifest.json` | file names, sizes, SHA-256 of the above | — |
| `places/`, private artwork | as in [Local full build](LOCAL_FULL_BUILD.md) | — |

The previously tested installer was about 122 MB, mostly the city catalog and artwork. The future larger base will increase its size.

## The slice is the same data, not a re-computation

`scripts/ephemeris/slice-de441.mjs` copies the 8 144-byte coefficient records of 32 days each byte for byte and rewrites only the start and end dates in the header, so the engine's reader opens it as an ordinary, shorter file. No astronomy is done in the script. `--verify` compares every copied record with the full file, and the staging script runs it each time.

Checked on 2026-11-17: 404 requests through the native executable (fictional instants and places 1900–2033, including both ends) returned **byte-identical** responses with the full 2.8 GB file and with the slice. The 67 Rust tests also pass with the slice as the DE441 file.

## Producing an installer

The data stay outside the repository (`.local/` is git-ignored). From files you hold locally:

```powershell
node scripts/ephemeris/prepare-data-bundle.mjs <full-de441.eph> <usno-dir> <chiron.bsp>
npm run build:installer
```

`build:installer` builds the private-artwork UI and runs `tauri build --bundles nsis` with the city-catalog and ephemeris configuration overrides. It does not download anything and fails if a staged file is missing. The ordinary `build:ui` / `tauri:build` stay free of private material and data, so the public-source build still works without them (it then has no provider).

The v2 verifier now **fails closed on stale staging manifests** or slices
whose stated year range omits any of 1000–2200. The slicing script's
byte-for-byte record comparison remains a separate mandatory preflight;
manifest metadata alone never authenticates the NASA/JPL source. A verified
private data bundle is not permission to distribute the third-party files.

## Where the host looks

Environment variable, then `ephemeris.json`, then the shipped files ([provider](VIRGOSTARS_EPHEMERIS_PROVIDER.md)). Installing a full DE441 file later therefore needs only a path in `ephemeris.json`.

## Not done

- Code signing and the updater (SmartScreen will warn on an unsigned installer).
- A first-run download of the full 2.8 GB file; it needs a hosting decision and a signed manifest.
- Confirmation of the rights to redistribute each data file.
