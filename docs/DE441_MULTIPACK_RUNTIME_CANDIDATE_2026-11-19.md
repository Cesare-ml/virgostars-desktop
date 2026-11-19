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

The chart, lunar, fixed-star, Chiron, luminary and modern solar-day paths select
each DE441 state by its own epoch. The historical chart path uses the provider
for planets and lunar points. Historical solar-event searches are not exposed
by the provider-backed snapshot and fail if explicitly requested; the separate
historical-planet sensitivity command still uses the single-file reader. The
normal UTC path retains its own time-policy bounds: historical dates require
the explicit historical civil-time and delta-T contract.

The catalog transport is not yet connected to Desktop IPC, settings or a
first-run wizard. No release catalog digest is configured by default. A future
installation or removal operation must coordinate with the active engine,
release its reader before removal on Windows, and revalidate before use.

The ignored local integration test checks a pinned private catalog and the
adjacent 800–999 and 2201–2400 slices against the full source at 900, 1000,
2000 and 2201, plus modern apparent positions. These are same-source
comparisons, not independent scientific validation. Source provenance and
redistribution rights remain unresolved; no data is published by this work.
