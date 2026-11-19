# tz-lookup

The file `src/app/vendor/tz-lookup.cjs` is the unmodified `tz.js` from
tz-lookup 6.1.25 by The Dark Sky Company, copied from the existing VirgoStars
dependency. Its SHA-256 is
`906852259d2157fa80d44eaa8c170ab731ae6497a0a0a066452b79a43125c8d4`.
The upstream license is CC0-1.0; see [LICENSE](LICENSE).

It uses compressed timezone-boundary-builder data dated 2019-01-06. Geographic
boundaries are approximate and can be outdated; Desktop presents the result as
an editable suggestion, not a verified historical timezone. Time and DST
offsets still come from the runtime's IANA timezone implementation.
