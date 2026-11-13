# Native offline-place search error boundary

**Status:** pure TypeScript error handling hardening; tests executed in a local isolated copy of the module. No Windows native smoke or complete Angular build has been run for this increment.

Tauri's `search_offline_places` IPC may reject with an ordinary string. Before this change, `OfflinePlaceSearch.search()` invoked `String(error)` inside its rejection handler; the thrown value can be an object with a broken or deliberately throwing `toString`/`Symbol.toPrimitive`. Such a value could make the search promise itself reject instead of returning a bounded, sanitized status. A fabricated object could also stringify to `PLACE_SEARCH_BUSY` and be misclassified as a real native status.

The search now recognizes only an exact string or a genuine `Error.message` string. Conversion and property-access failures become `{kind:'unavailable',items:[]}`. Only the two reviewed native codes, `PLACE_SEARCH_BUSY` and `PLACE_CATALOG_UNAVAILABLE`, produce special statuses. Stale failures remain `stale` and cannot displace a newer query. No native error object, filesystem path or SQL text enters UI results or logs.

## Verification

Executed in a standalone local source copy on Node.js 22.16.0:
- `node --experimental-strip-types --test tests/offline-place-error-boundary.test.mjs`: **5/5 pass**.
- `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/native/offline-places-contract.ts`: **pass** using TypeScript 5.8.3.

Pending: full repository `npm test`, Angular `build:ui`, actual Tauri IPC and WebView2 Windows acceptance. This change does not modify real city catalogs, user records, network access, dependencies, licensing, GitHub Actions, releases or production infrastructure.
