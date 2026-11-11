# Offline city and timezone catalog — product and data contract

**Decision: offline city search is required for the first usable VirgoStars Desktop. 2026-11-11.**
**Status: technical design / license and dataset selection pending. No city database has yet been bundled in the executable.**

## User experience

- The first run works without Internet, a VirgoStars account, browser location permissions or an API key. The user chooses **city → region/country → timezone** from a bundled local index, or enters manual latitude/longitude and IANA zone ID.
- Search offline by city name, alternate spelling, accents, localized name, admin region and country. Disambiguate places with identical names using country, region and coordinates. Never pick the wrong city silently.
- A chosen place has a **stable source ID** and saved snapshot of name, country/region, latitude, longitude, timezone ID, source/provider, dataset release and whether coordinates were manually overridden. If a locality is renamed, the natal chart must keep its original saved coordinates and civil-time meaning.
- The clock's location comes from the user's saved default place. Do not query precise GPS or infer location without explicit consent. When first opening offline with no place, still display system time and request a place before claiming an accurate house/Ascendant chart.
- If online, offer **optional** search/refresh for cities missing from the local index. The offline catalog is the default and continues to work if a web request fails. The online API must be explicitly approved and rate-limited; a server account/login must not be required to use core geocoding.

## Candidate data strategy (final distribution requires legal and QA review)

1. Review the existing VirgoStars online **city schema** for geographic IDs, country/admin levels, aliases, GPS coordinate provenance, timezone rules and data licenses. **Do not copy private production database records** or use the online site's city database without rights and provenance review.
2. Prefer a versioned downloadable **GeoNames** extract for the local index if license obligations and completeness pass. GeoNames makes downloadable country/world data available under an attribution license (CC BY); credit and link to GeoNames in About/Credits and shipped documentation. Source: https://www.geonames.org/export/ . Candidate exports to benchmark: `cities15000` for small baseline plus a broader `cities500` or national subsets for small localities. These are **candidate tiers, not a committed set or fixed download size**.
3. Timezone rules: store a stable IANA timezone identifier and use a versioned, reproducible **IANA tzdb** dataset for historical offset/DST resolution, rather than storing a present-day UTC offset as though it applied at a birth date. Source: https://www.iana.org/time-zones . Validate its release, distribution rights and build packaging separately.
4. Build a local **SQLite read-only reference catalog** (or other measured indexed embedded format): country, admin1/admin2, canonical name, aliases, locale, normalized search key, coordinates, timezone ID and source IDs. FTS/diacritic-folded prefix search and small bounded results; do not scan all cities on every keystroke.
5. Keep a **mutable user-local favorites/recent places table** separate from the shared read-only catalog and separate from the natal archive; never alter the signed/reference dataset when users add a custom place.
6. Download updates only with user-visible consent/configured update policy, signed/checksummed version metadata and atomic swap with rollback; never block offline startup. Existing chart coordinates remain frozen unless the user explicitly confirms an edit.

## Data quality / timezone correctness

- Save **local civil date/time, IANA zone ID, resolved UTC instant (when valid), chosen DST disambiguation and geodetic coordinates**. Preserve the user's originally entered local values; do not silently regenerate or overwrite them after tzdb updates.
- Distinguish timezone **gap** (nonexistent local clock time) and **fold** (ambiguous local clock time). Offer choices or an error; never choose one without informing the user. Historic timestamps outside supported tzdb accuracy must display warnings.
- Longitude/latitude limits, signs, decimal and sexagesimal entry, region/country disambiguation, UTF-8 names, negative years if supported by the date model, leap days and Gregorian calendar cutovers need explicit validated rules. Do not infer an offset from longitude alone.
- The city dataset's timezone identifier may not represent all historical local rules or place boundaries. Validate ID mapping and permit manual correction without corrupting a saved chart.
- A place's *political name* is not a unique ID. Compare places by stable source ID and, when necessary, coordinates plus country/region. Preserve alias/synonym search results.
- For remote enrichment, distinguish missing offline data, online result, revised coordinates and timezone change. Show differences before adopting an update; no invisible rewrite of historical charts.
- Audit packaging: archive file size (compressed/uncompressed), on-disk SQLite size, startup time, index query latency, RSS impact and licensing notices on Windows/macOS. Performance thresholds are measured on test hardware, not guessed.
- The city update flow is **not** the same as personal VirgoStars account sync. Public reference catalog can update globally, while account sync concerns only user data and edits.

## Minimal API boundaries (not implemented)

`PlaceSearchPort.search(query, region?, limit, locale) -> PlaceCandidate[]`: default local index, cancellation and latest-query-wins. Typed candidates always include location ID, country/region labels, geocoordinates and provenance.

`TimezonePort.resolve(civilTime, timeZoneId, ambiguityChoice?) -> {instantUtc?, status, offset, rulesVersion}`: no silent DST assignment; calendars and clocks validated.

`OnlinePlaceEnrichment`: optional adapter used **only** after explicit online action, never a requirement to load a chart; no proprietary service key embedded in desktop binary.

`PlaceDatasetUpdater`: separately approved catalog downloader/validator, never modifies an already saved natal instant or local user records.

## Acceptance cases

- [ ] Disconnect network before first app launch: search common and small-town test places, select, save a natal chart, reopen with exact coordinates and timezone.
- [ ] Search an accent and unaccented alias, same-name cities in different countries/regions, and a custom manually entered coordinate.
- [ ] Parse a birth date on either side of a historical DST change; ambiguous/nonexistent local time shows an explicit choice/status.
- [ ] Boot with outdated/absent optional city update service: local search still works and current chart is not lost.
- [ ] Adding/replacing public city catalog does not overwrite stored chart place snapshots or ID mappings; rollback works after bad update.
- [ ] Offline clock and chart use chosen timezone, with a separate UTC label and a correctly specified current time.
- [ ] Verify license/attribution, offline package footprint and no unexpected network/geolocation requests.
- [ ] Bench search latency, peak memory and size on an ordinary Windows laptop; no full data-file load per keypress.
- [ ] Existing VirgoStars online city IDs are mapped only after actual backend schema inspection and approved migration rules; do not invent mappings.

**Decision pending:** exact GeoNames tier, use of country subsets, byte budget, localization coverage, online data source, release-check interval and city provider compatibility. Document measurements and licensing before bundling data, not after.
