# Stellar source comparison — local diagnostic

Status: exploratory, 2026-11-18. This compares the owner's COW export with the
existing local Astrodienst star reference; it does not include or redistribute
that reference in Desktop and does not independently validate either dataset.

Using the legacy `STARS_ASTRODIENST_TO_COW_ID` mapping, 91 named objects had
both a prepared COW J2000 ecliptic direction and an ICRS entry in the local
`database/effemeridi/astrodienst/sefstars.txt` reference. The ICRS direction
was rotated with J2000 obliquity for a coarse, same-epoch comparison; apparent
effects and proper-motion propagation were excluded. Median absolute longitude
difference was 0.25 arcminute and the 90th percentile 0.50 arcminute. Median
absolute latitude difference was 0.49 arcminute and the 90th percentile 1.09
arcminutes. These statistics do not cover the other 647 catalogue entries or
years other than 2000, and this is not an accepted precision budget.

Three outliers need separate review. The legacy mapping for `Gienah Ghurab`
points to an entry designated epsilon Cygni in the reference while the COW row
is labelled Corvus; `Tureis` also resolves to different constellations in the
two sources. These are possible name/identity conflicts, not evidence that the
owner's record is wrong. `Mintaka` differed by about 40 arcminutes in latitude
despite close longitude and likewise needs source verification. No data was
automatically overwritten or declared validated from this comparison.
