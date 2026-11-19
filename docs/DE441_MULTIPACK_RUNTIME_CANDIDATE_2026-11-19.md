# DE441 multipack Desktop runtime candidate

Status: **experimental Desktop integration**, stacked on the catalog and
transport changes. The pinned core from Ephemeris PR #652 has been integrated
on Ephemeris main. DE441 data is published separately; this does not make the
private Desktop installer a public application release.

The installer build compiles the reviewed catalog SHA-256 into the application
and stages the matching catalog resource with the exact required base. A
different base or catalog causes the installer preflight to fail. For isolated
development builds, `VIRGOSTARS_DE441_CATALOG_SHA256` can be set **at compile time**; the installed
resource `ephemeris/de441-release-catalog-v1.json` must match that lowercase
SHA-256 digest. The base and every installed optional pack are checked against
the catalog and the installation must be contiguous before the provider opens.
The optional files are looked up only under the application local-data folder's
`de441-packs` directory. An invalid configured catalog fails closed. A user
who explicitly configures another DE441 file retains the single-file provider.
Without a catalog pin this candidate leaves existing behavior unchanged.

At an installed coverage edge, retarded and finite-difference sub-samples may
use the already-verified edge file's physical coefficient overlap. Reception
epochs are independently checked against the original logical installed
interval. This permits the first instant of year 1000 without requiring the
800–999 package, without accepting dates outside the installed logical range.

The chart, lunar, fixed-star, Chiron, luminary and modern solar-day paths select
each DE441 state by its own epoch. The historical chart path uses the provider
for planets and lunar points. The historical-planet diagnostic and its
explicit delta-T sensitivity samples also use the provider. Historical
solar-event searches are not exposed by the provider-backed snapshot and fail
if explicitly requested. The
normal UTC path retains its own time-policy bounds: historical dates require
the explicit historical civil-time and delta-T contract.

The restricted `de441_packages` IPC provides inventory, preview, download,
cancellation and edge-only removal. URLs and paths remain host-controlled.
The preview includes all intervening packages and byte count; starting a job
requires the same plan after revalidation. Settings and a first-run dialog call
that contract. Both use a two-ended timeline whose stops map to catalog
boundaries, without manual year entry; “Install everything” first shows the
same coverage and size confirmation. User-facing dates use BCE/CE rather than
astronomical year numbering, and progress represents the whole approved
download, not just the current file. Installation/removal serialize against the engine and discard
its cached reader; installed files are revalidated before use. Downloads can
resume after interruption. No release catalog digest is configured by default.

The generated catalog covers complete data years −13000–16999, but this is not
the supported range of a complete historical chart. The current Desktop chart
contract is limited to −12999–3999, and the core's experimental lunar mean
point correction and long-term orientation have their own numerical guards.
Do not widen those scientific model guards merely because kernel data exists.
The UI distinguishes installed data coverage from the complete chart limit.
Historical requests outside installed DE441 coverage return a dedicated status
that directs users to the package settings, distinct from delta-T policy and
general calculation errors.

The ignored local integration test checks a pinned private catalog and the
adjacent 800–999 and 2201–2400 slices against the full source at 900, 1000,
2000 and 2201, plus modern apparent positions. It also checks 1000-01-01 with
the preceding package absent and rejects a 999 reception epoch. These are same-source
comparisons, not independent scientific validation.
An additional explicitly invoked test plans, downloads a real local adjacent
package over a test-only localhost endpoint, activates it and removes it. The
unit-test loopback override is compiled only under `cfg(test)`. A separate
`de441-loopback-test` feature is guarded against release compilation and
requires an isolated application identifier. It selects only the fixed
`127.0.0.1:47840` endpoint and disables redirects. In that debug-only build,
the actual wizard downloaded the private 800–999 package, calculated a year
900 chart, removed the edge pack and rejected that chart afterwards. Normal
release code constructs its fixed GitHub release URL from the authenticated
catalog.

## Distribution and source

The owner authorized release of these DE441 slices and identified the source
as NASA/JPL. The full local classic binary's SHA-256 is
`476096486def4e41bfceb29aa27f50784da0bce318902bcf7b88caad058cd4da`;
its MD5 `4e3b924463d17b68ec9c4a18240300cd` matches the current
[Astrodienst JPL download listing](https://www.astro.com/swisseph-download/jplfiles/),
which identifies the renamed source as JPL's
`Linux/de441/linux_m13000p17000.441`. JPL documents the
[Linux binary distribution](https://ssd.jpl.nasa.gov/planets/eph_export.html).
The MD5 corroborates identity but is not an independent cryptographic
attestation by NASA. On 2026-11-19 the binary downloaded directly from
[NASA/JPL](https://ssd.jpl.nasa.gov/ftp/eph/planets/Linux/de441/linux_m13000p17000.441)
also matched the local SHA-256 in a
[GitHub-hosted run](https://github.com/Cesare-ml/VirgoStars-Ephemeris/actions/runs/44599499075).
That confirms byte identity with the JPL download but is not a NASA-signed
checksum; the owner's rights assertion is recorded as such.
The project's CPAL license applies to its source code, not automatically to
JPL data.

On 2026-11-19 the existing real-file reader test passed using that exact
source. Its J2000 Earth-relative-to-solar-system-barycenter position was
independently compared with the JPL Horizons API, target 399, center 500@0,
geometric ICRF frame, JD 2451545.0 TDB, in km. Horizons identified DE441
for both bodies and reported [-27566740.48281145, 132361381.1535491,
57418653.28625385], matching the reader's recorded reference within
0.000001 km per coordinate. This single vector does not validate all bodies,
epochs, velocities, frames, corrections, or historical chart models.

The reviewed catalog selects `de441-desktop-v1.0.0` as the default release
and reuses five byte-identical 0–999 files already in
`de441-mobile-v1.0.0`. A per-file release tag remains a single validated
path component, and hosts and paths remain fixed in the Rust downloader.
The [Desktop data release](https://github.com/Cesare-ml/VirgoStars-Ephemeris/releases/tag/de441-desktop-v1.0.0)
is public. All 145 catalog entries, including five Mobile assets, and the
catalog itself were checked against GitHub's asset sizes and SHA-256 values
before publication. The temporary GitHub upload workflow was removed after use.
An explicitly invoked network test then downloaded the 2201–2400 asset from
the public Desktop release through the production downloader and verified its
SHA-256. The same downloader had also verified the 800–999 Mobile asset.
