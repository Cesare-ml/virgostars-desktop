# Selected-city clock: malformed runtime input boundary

**Status:** Prototype hardening; not native Windows/WebView2 acceptance.

The Settings inspector shows a second, civil-time-only clock for the currently
selected offline city. The selected city is an optional object whose `timeZone`
field is supplied by the offline place picker. The type contract is narrow, but
at runtime a stale UI callback, malformed test port, or unusual accessor-backed
object may not honor TypeScript's static type.

## Fail-closed behavior

- `null` explicitly means **no city selected** (`not_selected`).
- Missing, primitive, array, revoked-proxy or otherwise malformed city objects
  resolve to **unavailable**, never an exception that aborts Angular rendering.
- The city `timeZone` property is read **once** under an exception boundary;
  a throwing getter cannot leak its error contents into the UI, and a changing
  getter cannot mix a displayed timezone with a different provenance label.
- Existing IANA identifier validation and `Intl.DateTimeFormat` support remain
  authoritative. No silent fallback to the device's timezone is allowed.
- Valid plain objects, including `{timeZone: 'Europe/Rome'}`, keep their existing
  displayed result and DST behavior. The feature does not alter the device clock,
  chart data, birth time, calculated positions, or local/remote records.

## Focused regression tests

```sh
node --experimental-strip-types --test tests/selected-city-clock.test.mjs
npm test
npm run build:ui
```

The added tests cover malformed runtime values, a getter that must be sampled
exactly once, a throwing getter and a revoked Proxy. They use only fictional
locations/time samples. Passing Node tests do not establish that the Angular
component renders properly in the packaged Tauri/WebView2 runtime.

## Architecture and privacy boundaries

Pure TypeScript UI formatter only: no new Tauri IPC, file permissions, network,
account authorization, sync, persistent birth data, third-party assets, new
dependencies, astronomy implementation, license change or release workflow.
Keep native and browser builds separate in acceptance reporting.

Before merging, run the full repository test and UI build with the compatible
public Charts sibling, then test the Settings inspector on Windows: select,
clear and change a city, switch IT/EN and light/dark, and verify a malformed
timezone displays the translated unavailable state without breaking the chart.
No GitHub Actions, production rollout or direct merge to `main` is included.
