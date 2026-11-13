# Native offline city search

The Tauri command `search_offline_places` opens the fixed resource `places/world-cities.sqlite` **read-only**. The Angular frontend cannot supply a filesystem path or SQL. Native search returns no more than 30 matches and limits concurrent native queries to two. Coordinates are in integer microdegrees; an IANA timezone identifier is not a historical UTC offset.

## Scoped lookup lifecycle

Each `vs-offline-city-picker` component now creates a separate `OfflinePlaceSearch` instance with its own request generation. Dismissing, editing or destroying one picker cannot invalidate a request belonging to a second picker. The older module singleton remains temporarily exported for compatibility but must not be used for a new UI picker.

The picker debounces input, ignores obsolete responses, supports keyboard navigation and retains only its current bounded result set. If a request is reported as stale even though it is the picker's latest request, the UI exits `loading`, shows the existing retryable `busy` state and allows another search. Native transport errors are mapped to sanitized statuses; no local filesystem path is displayed.

Selection is temporary and remains in memory. It does **not** save a birth chart, calculate a historical UTC instant or change the synthetic example chart. Browser previews and builds without the packaged catalog report explicit unavailable statuses.

## Build and acceptance

The default build does not include private catalog data. To package an authorized catalog, use the verified overlay described in [Local city packaging](LOCAL_CITY_PACKAGING.md). Before treating search as production-ready, run the Node regression suite and verify offline Windows WebView2 behavior with the actual bundled resource, simultaneous pickers, missing catalog and fast navigation. These are **pending native acceptance gates**, not claims of completed Windows testing.

No astronomy, auth, personal birth data, production APIs, privilege changes, network access, updater or release is introduced here.

## Temporary selection: clear and disambiguation (prototype)

The Settings inspector now provides a keyboard-focusable **Clear location** action for an explicitly selected offline place, with Italian and English labels. The selection summary also displays available region, country and IANA time-zone metadata to distinguish places that share a name. Missing metadata is omitted rather than invented. The original native result ID and coordinates remain in memory only while selected.

Clearing invalidates the pending debounce/native lookup generation, removes suggestions, clears the query and temporary selected record, and notifies the parent inspector so reopening the tab cannot silently restore the previous city. A late native response cannot undo this action. Neither choosing nor clearing a city writes a database, starts a network request, resolves historical time zones or changes synthetic chart positions.

Synthetic Node regressions are in `tests/offline-city-selection.test.mjs`. Runtime/manual acceptance still requires compiling the Angular application and checking keyboard/focus, narrow window layout, clearing followed by inspector close/reopen, and real offline search under Windows Tauri/WebView2 with a licensed catalog installed.

## Fail-closed TypeScript/native IPC boundary

The Angular-side `OfflinePlaceSearch` rejects queries containing fewer than two Unicode letters/digits or more than 80 Unicode code points **before** invoking Tauri. This mirrors the bounded Rust input gate (Rust alone builds the fixed FTS5 query; the WebView never constructs SQL). A response containing more results than the explicit requested limit is rejected, even though the protocol-wide maximum remains 30.

Only the exact Rust rejection strings `PLACE_SEARCH_BUSY` and `PLACE_CATALOG_UNAVAILABLE` are converted into recognizable UI statuses; arbitrary rejected objects are never passed through `String(error)` or printed. Other errors become a generic unavailable status. Late responses are still discarded when `clear()`, `dispose()`, or a newer search invalidates their generation.

Synthetic regression coverage: `tests/offline-place-ipc-boundaries.test.mjs` exercises international and astral Unicode, 80/81 code-point bounds, over-limit native replies, hostile error objects, exact error-code mapping, and cancellation order. These checks do not prove the licensed catalog, native Windows IPC or the GUI works; run the full suite and a Tauri/WebView2 smoke test before merging.

## Integration-specific Unicode and concurrency regression

The picker limits input to 80 **Unicode scalar values**, not 80 UTF-16 code units, matching both the Angular IPC boundary and Rust's character-count limit. The HTML field allows up to 160 UTF-16 code units (so 80 supplementary-plane characters fit), and the input handler mirrors the 80-code-point-bounded state back into the visible field; the longer HTML limit never enlarges native search queries. One picker no longer cancels another picker's pending native result because each component creates an independent `OfflinePlaceSearch`. A cleared selection is not reinstated by a late reply; a current `stale` native status becomes retryable `busy` instead of hanging in `loading`.

Run `node --experimental-strip-types --test tests/offline-city-picker-integration.test.mjs` with a complete Node.js 22 checkout. Combined builds must additionally run the existing city-picker, native search and IPC suite, then a manual Windows Tauri/WebView2 test with an authorized installed catalog. The default demo remains entirely synthetic; no birth chart or city coordinate is persisted or used for astronomy.

