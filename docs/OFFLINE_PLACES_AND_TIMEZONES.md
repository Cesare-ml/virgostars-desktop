# Offline city and timezone catalog — product and data contract

**Decision: offline city search is required for the first usable VirgoStars Desktop. 2026-11-11.**
**Status: technical design / license and dataset selection pending. No city database has yet been bundled in the executable.**

## User experience

- The first run works without Internet, a VirgoStars account, browser location permissions or an API key. The user chooses **city → region/country → timezone** from a bundled local index, or enters manual latitude/longitude and IANA zone ID.
- Search offline by city name, alternate spelling, accents, localized name, admin region and country. Disambiguate places with identical names using country, region and coordinates. Never pick the wrong city silently.
- A chosen place has a **stable source ID** and saved snapshot of name, country/region, latitude, longitude, timezone ID, source/provider, dataset release and whether coordinates were manually overridden. If a locality is renamed, the natal chart must keep its original saved coordinates and civil-time meaning.
- The clock's location comes from the user's saved default place. Do not query precise GPS or infer location without explicit consent. When first opening offline with no place, still display system time and request a place before claiming an accurate house/Ascendant chart.
- If online, offer **optional** search/refresh for cities missing from the local index. The offline catalog is the default and continues to work if a web request fails. The online API must be explicitly approved and rate-limited; a server account/login must not be required to use core geocoding.

## 2026-11-11 schema evidence and sizing guide

Owner-provided PostgreSQL sample shows `id`, `nome`, `nome_it`, `lat`, `lng`, `pop`, `stato_id`, `regione`, `tz` and `tz_offs`. The owner confirms the acquired dataset is usable for the project; exact distribution notice/provenance should be recorded before the free desktop release. The appropriate next step is **not to reject the full 1,951,599-row source because of an unmeasured 1 GB guess**: run the read-only PostgreSQL size inspection and privately benchmark a slim indexed SQLite export. See [Owned City Catalog Sizing](OWNED_CITY_CATALOG_SIZING.md).

## 2026-11-11 evaluation update — existing purchased city collection

The maintainer owns a previously purchased **PostgreSQL collection containing 1,951,599 city records worldwide**. This is a **candidate source**, not permission to embed or publish it. We have **not** inspected the actual purchased dataset, its fields, license, indexes or measured size. The previous frontend's city record shape (city, lat/lon, country, region, timezone ID/offset) is only contextual evidence of UI expectations; do not assume the purchased PostgreSQL schema matches.

**Provisional preference: offline-first hybrid with an optional remote supplement**, not a forced decision to use either the purchased collection or GeoNames. Three candidate packaging strategies must be measured:

| Strategy | Offline behavior | Installation | Legal dependency |
| --- | --- | --- | --- |
| A. Convert the full purchased `1,951,599` cities to slim read-only SQLite | Nearly full purchased-catalog search offline; manual coordinates still possible | Embedded DB footprint measured after export, indexing and compression | Purchased license must explicitly allow redistribution as part of a free/possibly open-source desktop application; buying access alone is not such permission |
| B. Bundle a curated GeoNames city subset (`cities15000`, `cities500` or selected subsets) with optional full offline catalog download | Common cities offline by default; users can optionally install wider offline coverage | Smaller default footprint, user-selectable expansion | GeoNames attribution and version/provenance review; optional pack signed and checksum-verified |
| C. Lightweight offline subset + online lookup | Common cities and manual coordinates offline; remote fills only missing places | Small installation, network only for enrichment | Online provider terms, request/rate budget and user privacy; if using purchased data through VirgoStars backend, license must permit that service use too |

**Key insight:** Two million *minimal* records in a **read-only, indexed SQLite file** are not equivalent to requiring a PostgreSQL server on users' PCs. No definitive MB size or memory cost can be inferred from row count alone. Read-only SQLite queries retrieve indexed pages rather than loading every place in RAM. Measure actual DB size and FTS index size with the real licensed input before rejecting strategy A. Avoid bundling imported PostgreSQL caches, logs, user data, or unnecessary columns.

### Preferred architecture (works with any selected dataset)

- `LocalPlaceProvider`: lookup by normalized city name, aliases, region/country and prefix, with bounded results and FTS/indexes. **Always queried first**. Cached default place and saved natal chart remain usable with the network fully disconnected.
- `RemotePlaceProvider`: **optional** search via a reviewed provider only on user request, or after a clearly disclosed zero-local-result fallback with opt-in. Candidate: owner-operated VirgoStars query service over the existing PostgreSQL collection, **if licensed for hosted access**, with publicly documented anonymous rate-limited endpoints that do not require an account. A third-party provider is a separate option after terms/price/privacy review.
- `PlaceReconciler`: user compares remote and local candidate IDs, country/region and lat/lon; preserve original saved coordinates/time zone/instant. Never treat identical names as identical location IDs. No automatic silent replacement of local records after an online match.
- `PlacesDatasetUpdater`: reference catalog releases are **independent** of personal cloud account sync. Signed/checksummed and rolled back atomically. Optional full pack stored outside the executable in application data, not in Angular asset memory.
- `TimezonePort`: stable IANA tz identifier + **versioned IANA tzdb rules** independent of which city dataset provided the place. A present-day `tz_offs` field is **not** valid historical offset evidence. tzdb records many historic transitions but does not promise fully accurate civil time before 1970 everywhere.
- `CustomPlaceProvider`: manual coordinates, editable timezone selection, favorites and recently used. Manual entry is always available even when no city search result exists; birth chart creation does not require online enrichment or a matching official place name.

### Provider constraints and user privacy

- GeoNames downloadable exports are CC BY (attribution required), have daily refreshes and offer a free web service with stated request quotas; confirm current terms, API keys, allowed usage and application-level limits before implementing remote search. https://www.geonames.org/export/
- **Do not embed public OSMF Nominatim as typeahead/autocomplete**: its official public endpoint policy explicitly prohibits client-side automatic autocomplete, caps requests (absolute max 1 req/s across the application) and has other restrictions. Self-hosted/other providers have distinct terms. https://operations.osmfoundation.org/policies/nominatim/
- Internet place searches can reveal the city being entered, potentially a birthplace. Explain when a query leaves the device, send **only** the minimum search string and optional country/region (never subject name, date/time of birth, notes or complete chart), limit/cancel/debounce searches, avoid logging query content, and make online lookup disable-able.
- An owner-operated VirgoStars online catalog is not automatically more up-to-date than GeoNames: a once-purchased PostgreSQL dataset needs an **approved refresh pipeline** and version/provenance; do not advertise "always updated" without an actual schedule and source.
- SQLite reference city DB is separate from the guest user's encrypted personal archive. Public city data do not need SQLCipher; saved personal natal charts may require it. Never let a location catalog update modify saved subject fields.

### Required proof before dataset choice

1. **Rights audit (blocking):** identify purchased vendor/product, original order/license, permission for local software redistribution/free/open source, modified extracts, direct anonymous hosted API, caching and required attribution. Do not publish a sample of purchased records until authorized.
2. **Schema audit (read-only):** record actual table name/columns, unique city IDs, name/aliases, country ISO2, region/admin hierarchy, coordinate datum, IANA `tz` vs fixed `tz_offs`, duplicates, covered countries and last update date. Never export raw production user data.
3. **Controlled benchmark:** with an authorized private test copy, export only needed city columns and compare (i) full purchased collection, (ii) curated GeoNames tier(s), (iii) core + optional full pack. Record SQLite bytes, FTS bytes, compressed distribution bytes, build time, cold-start peak RAM, p50/p95 search latency on Windows, result quality and 10k synthetic prefix searches. Choose numeric limits only after measurement; avoid made-up size claims.
4. **Coverage test:** common/rare places, accented aliases, namesakes across countries, edge-region coordinates, small historical places and manual location. Compare original catalog vs GeoNames; establish a quality score rather than assuming millions of records means better correct matching.
5. **Offline acceptance:** first launch in airplane mode, choose uncommon city, calculate validated chart using historically correct TZ rules, save/reopen after restart. No login.
6. **Online acceptance:** opt-in only, provider unavailable/rate-limited/changed API → offline search and manual entry still work. Internet never required for normal city searches. Prove no birth details beyond requested city text are uploaded.
7. **Release gate:** signed/verified optional catalog updates, licensing credits and offline format migration. Separate from chart archive SQLCipher schema.

**Provisional direction:** if purchased redistribution permits it and full compressed index size/startup are acceptable, consider **full local SQLite as default**, with optional remote corrections. If rights prohibit bundling, use a **licensed compact GeoNames core plus optional wider GeoNames offline download and optional VirgoStars-hosted lookup** where separately licensed. Do not decide the exact tier/format until the above tests are recorded.


## Candidate data strategy (final distribution requires legal and QA review)

1. Review the existing VirgoStars online **city schema** for geographic IDs, country/admin levels, aliases, GPS coordinate provenance, timezone rules and data licenses. **Do not copy private production database records** or use the online site's city database without rights and provenance review.
2. **Evaluate a versioned GeoNames extract and the owner's purchased 1,951,599-city PostgreSQL collection in parallel**. Select a source only after the purchased-data rights audit and real SQLite sizing/coverage benchmarks; GeoNames is the redistributable fallback candidate, not a predetermined choice. GeoNames data can be locally downloaded if license obligations and completeness pass. GeoNames makes downloadable country/world data available under an attribution license (CC BY); credit and link to GeoNames in About/Credits and shipped documentation. Source: https://www.geonames.org/export/ . Candidate exports to benchmark: `cities15000` for small baseline plus a broader `cities500` or national subsets for small localities. These are **candidate tiers, not a committed set or fixed download size**.
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

**Decision pending:** purchased-data redistribution and hosted-API licensing, actual full/compact SQLite benchmarks, GeoNames tier, localization coverage, online provider, update cadence and city-ID compatibility. Do not publish the purchased dataset or commit sample records before permission is verified. Document measurements and licensing before bundling data, not after.
