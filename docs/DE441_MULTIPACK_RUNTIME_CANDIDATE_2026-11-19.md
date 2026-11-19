# DE441 multipack Desktop runtime candidate

Status: **experimental local integration**, stacked on the catalog and transport
draft. This is not a release or a claim of published data. The pinned core is
the head of Ephemeris PR #652, itself stacked on #651.

When `VIRGOSTARS_DE441_CATALOG_SHA256` is set **at compile time**, the installed
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
for planets and lunar points. Historical solar-event searches are not exposed
by the provider-backed snapshot and fail if explicitly requested; the separate
historical-planet sensitivity command still uses the single-file reader. The
normal UTC path retains its own time-policy bounds: historical dates require
the explicit historical civil-time and delta-T contract.

The restricted `de441_packages` IPC provides inventory, preview, download,
cancellation and edge-only removal. URLs and paths remain host-controlled.
The preview includes all intervening packages and byte count; starting a job
requires the same plan after revalidation. Settings and a first-run dialog call
that contract. Installation/removal serialize against the engine and discard
its cached reader; installed files are revalidated before use. Downloads can
resume after interruption. No release catalog digest is configured by default.

The ignored local integration test checks a pinned private catalog and the
adjacent 800–999 and 2201–2400 slices against the full source at 900, 1000,
2000 and 2201, plus modern apparent positions. It also checks 1000-01-01 with
the preceding package absent and rejects a 999 reception epoch. These are same-source
comparisons, not independent scientific validation. Source provenance and
redistribution rights remain unresolved; no data is published by this work.
An additional explicitly invoked test plans, downloads a real local adjacent
package over a test-only localhost endpoint, activates it and removes it. The
loopback override is compiled only under `cfg(test)`; release code constructs
its fixed GitHub release URL from the authenticated catalog. The local catalog's
release tag is a placeholder: its packages have not been published, so a
normal network download cannot succeed until an authorized release exists.
