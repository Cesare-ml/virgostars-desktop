# Fixed stars in Desktop — MVP integration

**Historical checkpoint:** this document records the earlier list-only MVP.
The subsequently integrated experimental ring and interpretation display are
documented in [FIXED_STARS.md](FIXED_STARS.md); the earlier list interface
described below is not the current merged interface.

**Status: prototype under review.** Desktop can request fixed-star positions for
the current ordinary chart and presents a searchable list of computed apparent
longitudes. It requests the catalogue only when the user opens the panel; a
result for a previous chart is discarded. Historical dates remain deferred.
This first integration does not yet draw the experimental stellar ring or
compute contacts with chart points.

The Rust provider uses the existing VirgoStars-Ephemeris fixed-star algorithms
and the configured DE441 file. A catalogue may be supplied as `fixedStarCatalog`
in the host's `ephemeris.json`, in `ephemeris/fixed-stars.json` among installed
resources, or by the host environment variable `VIRGOSTARS_FIXED_STARS` (in
that precedence order, with the environment first). An explicitly configured
invalid catalogue is reported unavailable; it is never replaced silently.
Without any catalogue the sole built-in example is Sirius, and the panel says
so. No catalogue or interpretation data are committed by this integration.

The local, separately prepared catalogue contains 738 entries, 737 of which
are labelled approximate because their source does not supply stellar motion,
parallax or radial velocity. A real-DE441 local test produced over 700 results
and placed Sirius within a broad expected range. In an isolated Windows debug
build with a test archive key, the panel displayed 738 calculated entries and
search returned Regulus. These are functionality checks, not accuracy
guarantees. The panel marks approximate entries; longitudes and available
entries depend on the chosen catalogue and date.

The catalogue contract accepts at most 2,048 unique identities and 8 MiB of
UTF-8 JSON. Its `virgostars-desktop-stars/1` schema requires provenance, bounded
names and magnitudes, and either a full ICRS entry or an explicitly approximate
ecliptic direction. Host paths do not cross the WebView bridge. Existing local
prototype source and the owner-provided data remain outside this change.
