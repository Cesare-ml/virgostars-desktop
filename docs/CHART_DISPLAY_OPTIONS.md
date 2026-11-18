# Chart display options

Status: prototype, local implementation. Preferences are stored on the device; they do not change saved birth data.

- Southern inversion is opt-in and applies only to southern latitudes. The display uses opposite ecliptic positions and a mirrored chart, following the VirgoStars convention; the original calculated data remain unchanged.
- Hidden Uranus, Neptune and Pluto can be displayed when conjunct a shown point or an axis, within the outer planet's configured orb. The option has no visible effect for an outer planet that is already set to be shown.
- Planet of the year follows Regolo Alpha Leonis's seven 36-year blocks and its solar-year boundary. The glyph comes from the approved astrological-assets pack.
- Natal aspect focus retains the last hovered point. Applying/separating highlights only phases available from the longitude speeds; exact, equal-motion, natal-axis and declination cases remain indeterminate. The filter is suspended during Monomeri and zodiac projections.
- Dodecatemoria use colored dots for the all-points view and the actual celestial glyph for a single point. Decans use Regolo's Chaldean sequence; decades use the sign and its two trinal signs. These can be displayed together.
- Terms reproduce Regolo's elemental ring for Egyptian houses. This display is not a table of traditional unequal Egyptian bounds.

UI language defaults to the WebView system language, with English fallback. An explicit Italian or English preference and the interface theme may be set in Settings. Earlier saved language preferences are retained as explicit overrides. The account panel does not implement login, profile access or synchronization.
