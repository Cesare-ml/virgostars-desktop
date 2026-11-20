# Fixed stars: local prototype

Status: prototype. With DE441 configured, Desktop can compute an explicitly
prepared private catalogue and render contacts with visible natal points and
axes. When that catalogue is absent the default is a single-star Sirius
demonstration. A local WebView2 smoke test displayed the private catalogue and
one star's details. On Windows, clicking its website link opened the matching
VirgoStars star page in the system browser. Complete graphics and cross-platform
acceptance remain open.

The 0.0.3 owner installer staged the catalogue as a resource and also embedded
it in the executable. A later local change requests star positions for extended
dates using the same UT1 and ΔT as the displayed chart; previously the UI sent
an empty UTC string for that path. This fix is source code only until a new
installer is built and tested. Other causes of an unavailable catalogue in an
installed configuration have not been ruled out.
The upstream stellar orientation model is bounded to 1900–2100; a real-data
test confirms that the present adapter returns unavailable for years 1000 and
2200. Wider DE441 coverage alone does not extend that model.

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
These results are not equivalent to a validated stellar catalogue. A finite
parallax of 0.001 mas and zero motions are numerical
model assumptions, not measurements from the supplied tables.
An exploratory same-epoch comparison of 91 named objects and three outliers is
recorded in [the local reference diagnostic](STAR_REFERENCE_COMPARISON.md).

The default datum is HIP 32349 from Hipparcos I/239 at ICRS J1991.25:
https://vizier.cds.unistra.fr/cgi-bin/VizieR-5?-source=I%2F239%2Fhip_main&recno=32325 .
The adopted radial velocity is zero, explicitly an approximation; solar
deflection is enabled. Native IPC exposes south-through-west azimuth. Desktop
converts it back to north-through-east for the legacy contact rule: its AS/DS
labels assign the eastern horizon to AS and the western horizon to DS. An
axis contact is rendered at the corresponding chart axis; an ordinary
planetary conjunction retains the star's calculated ecliptic longitude.
The legacy meridian rule distinguishes MC and IC by compass direction, so it
does not reliably distinguish upper from lower culmination for every latitude
and circumpolar star. The horizon correction does not validate that rule.

The selected-star details use the existing fixed-width tools column, so selecting
a star does not resize or move the chart. Longitude
is the star's ecliptic longitude; azimuth is displayed north-through-east
(north 0°, east 90°), and altitude is geometric/true altitude. The catalogue
still distinguishes approximate entries, but their explanatory notice is no
longer shown in the selected-star card. Axis contacts use the Charts renderer's
existing opacity animation; Desktop repaints the existing scene while the
wheel is visible, stops its repaint timer when disabled or destroyed, and does
not request the animation when reduced motion is preferred.

Fixed-star settings apply to the current session. The optional maximum magnitude
includes known numeric magnitudes less than or equal to the chosen value; unknown
magnitudes have a separate inclusion switch. The slider's rightmost "all" setting
does not filter known magnitudes. Longitude conjunctions and axis contacts have
independent distance limits in degrees; zero disables that kind of contact.
Both limits start at 1 degree. The explicit save-as-default button stores only
star defaults on this device; earlier automatically saved star values are not
interpreted as explicit defaults. Slider movement previews the value and commits
the chart redraw on release. Axis contact detection still
uses the legacy horizon and meridian rules described above.
When fixed stars are active on the natal wheel, the existing right-hand tools
column shows only the star controls and selected-star details. The star settings
start collapsed, and the selected-star details are below them. Disabling stars
restores the other chart tools. Selecting a star does not resize that column or
move the wheel. The wider column also accommodates the Arabic-parts controls.

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
