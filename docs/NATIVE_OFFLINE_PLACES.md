# Native offline city search

The Tauri command `search_offline_places` opens the fixed resource `places/world-cities.sqlite` **read-only**. The Angular frontend cannot supply a filesystem path or SQL. Native search returns no more than 30 matches and limits concurrent native queries to two. Coordinates are in integer microdegrees; an IANA timezone identifier is not a historical UTC offset.

## Scoped lookup lifecycle

Each `vs-offline-city-picker` component now creates a separate `OfflinePlaceSearch` instance with its own request generation. Dismissing, editing or destroying one picker cannot invalidate a request belonging to a second picker. The older module singleton remains temporarily exported for compatibility but must not be used for a new UI picker.

The picker debounces input, ignores obsolete responses, supports keyboard navigation and retains only its current bounded result set. If a request is reported as stale even though it is the picker's latest request, the UI exits `loading`, shows the existing retryable `busy` state and allows another search. Native transport errors are mapped to sanitized statuses; no local filesystem path is displayed.

Selection is temporary and remains in memory. It does **not** save a birth chart, calculate a historical UTC instant or change the synthetic example chart. Browser previews and builds without the packaged catalog report explicit unavailable statuses.

## Build and acceptance

The default build does not include private catalog data. To package an authorized catalog, use the verified overlay described in [Local city packaging](LOCAL_CITY_PACKAGING.md). Before treating search as production-ready, run the Node regression suite and verify offline Windows WebView2 behavior with the actual bundled resource, simultaneous pickers, missing catalog and fast navigation. These are **pending native acceptance gates**, not claims of completed Windows testing.

No astronomy, auth, personal birth data, production APIs, privilege changes, network access, updater or release is introduced here.
