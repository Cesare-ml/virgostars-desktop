# Fixed stars: local prototype

Status: prototype. With DE441 configured, Desktop can compute an explicitly
prepared private catalogue and render contacts with visible natal points and
axes. When that catalogue is absent the default is a single-star Sirius
demonstration. A local WebView2 smoke test displayed the private catalogue and
one star's details. On Windows, clicking its website link opened the matching
VirgoStars star page in the system browser. Complete graphics and cross-platform
acceptance remain open.

The native `open_star_page` command accepts only a bounded integer ID. It builds
a fixed HTTPS URL on `virgostars.it` inside the host and asks the operating
system to open it; no chart data, arbitrary URL, program or path is accepted.
If opening fails, the interface reports an error and retains a copyable link.

The owner supplied `cow_stelle` and `cow_costellazioni` table exports on
2026-11-18. `prepare-cow-star-catalog.mjs` reads those explicit files and writes
only coordinates, names, constellation names and selected conjunction texts to
an ignored private file; it never copies the full tables or the general prose.
The local output has 738 stars, 558 individual interpretation entries on 73
stars, and nine rows without sufficient coordinates were omitted. Two sign
abbreviations were resolved against the 1900 values of the same source rows.
Sirius uses identified Hipparcos astrometry. The remaining 737 entries are
**approximate**: the source's J2000 ecliptic position is treated as a distant
fixed direction with unknown proper motion, parallax and radial velocity. The
UI labels these results as approximate; they are not equivalent to a validated
stellar catalogue. A finite parallax of 0.001 mas and zero motions are numerical
model assumptions, not measurements from the supplied tables.
An exploratory same-epoch comparison of 91 named objects and three outliers is
recorded in [the local reference diagnostic](STAR_REFERENCE_COMPARISON.md).

The default datum is HIP 32349 from Hipparcos I/239 at ICRS J1991.25:
https://vizier.cds.unistra.fr/cgi-bin/VizieR-5?-source=I%2F239%2Fhip_main&recno=32325 .
The adopted radial velocity is zero, explicitly an approximation; solar
deflection is enabled. Horizontal azimuth is converted from north/east to
south/west before the legacy VirgoStars contact convention is applied.

An owner-provided catalogue may be placed in the application resources as
`ephemeris/fixed-stars.json`, configured via the `fixedStarCatalog` absolute
path in the host-owned `ephemeris.json`, or set with the host environment
variable `VIRGOSTARS_FIXED_STARS`. Paths do not cross the WebView bridge.
An explicitly configured invalid catalogue is unavailable rather than silently
replaced by the sample. This option does not establish rights to distribute a
catalogue or interpretation; data owners must establish provenance and rights
before packaging. No account records or database credentials belong here.
For a **private local build**, the explicit build environment switch
`VIRGOSTARS_EMBED_PRIVATE_STARS=1` embeds the validated local catalogue from
`.local/ephemeris/fixed-stars.json` into the executable. Without that switch a
normal build never embeds it. This is not permission to redistribute third-party
interpretations and no public release is implied.
The local `tauri:dev`, `build:local` and `build:installer` entry points now
automatically select this switch when the separately supplied local catalogue
exists and passes the bounded metadata check. Public synthetic build paths do
not embed the private file; runtime validation still applies.
To include an approved catalogue in an ephemeris installer, pass it as the
sixth argument to `scripts/ephemeris/prepare-data-bundle.mjs` after the two
year arguments. The staging manifest then includes its SHA-256 and the Tauri
resource mapping. Staging does not perform a legal review or replace the
runtime's stricter schema validation.

The UTF-8 JSON contract is bounded to 8 MiB and 2048 unique entries. It must
identify the provenance. Numeric positions are either ICRS with an explicitly
supplied epoch and proper motions or a deliberately labelled approximate
ecliptic direction. The following
numbers and interpretation are fictional and only illustrate the schema:

```json
{
  "schema": "virgostars-desktop-stars/1",
  "provenance": "synthetic documentation example",
  "stars": [{
    "id": 1, "name": "Example Star", "magnitude": 2.0,
    "epochTdbJd": 2451545.0, "raDeg": 40.0, "decDeg": 20.0,
    "pmRaMasYear": 1.0, "pmDecMasYear": 1.0,
    "parallaxMas": 10.0, "radialVelocityKmS": 0.0,
    "interpretations": {"Sun": "Synthetic example."}
  }]
}
```

For the explicitly approximate variant, omit `raDeg`, `decDeg`, both proper
motions, `parallaxMas` and `radialVelocityKmS`, and supply
`"approximateEcliptic":{"longitudeDeg":40,"latitudeDeg":20}` with the
reference `epochTdbJd`. An unknown magnitude is JSON `null`. The optional
`constellation` is a plain name. These illustrative coordinates are fictional.

Interpretation keys use the application's celestial names (`Sun`, `Moon`,
etc.) or axis codes (`AS`, `DS`, `MC`, `IC`). Only texts for actual matching
contacts are shown; strings are rendered as text, not HTML. A source must map
the public VirgoStars star ID and meaningful plain text deliberately. The
reader does not fetch the website or database, infer IDs, grant reuse rights,
or turn generated content into reviewed interpretation.
