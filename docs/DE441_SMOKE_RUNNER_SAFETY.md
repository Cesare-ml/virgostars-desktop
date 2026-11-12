# DE441 smoke runner safety and bounded subprocess

**Status:** experimental and opt-in; no Desktop runtime, production or astronomical renderer change.

The earlier smoke runner passed empty numeric arguments through JavaScript number coercion and could wait indefinitely for Cargo. This follow-up adds strict five-argument parsing, canonical millisecond UTC with Gregorian date round-trip, explicit 1972-01-01 through 2027-06-27 IERS support range, bounded WGS84 coordinates and decimal height, control-free kernel path, and a fail-closed native subprocess.

The native launch is shell-free with a 5-minute timeout, SIGKILL termination request and 1-MiB stdout/stderr buffer bound. Timeout and native failures are sanitized to stable status codes; kernel paths, UTC values, coordinates, Cargo stderr and output JSON are never echoed to the user. An OS may still leave descendants of a terminated Cargo process, so this is not a complete process-tree sandbox.

The executable wrapper delegates scientific shape checks to the existing TypeScript experimental-sky receiver and requires an exact observer-height match. Successful output is explicitly labelled SHAPE_VALID_EXPERIMENTAL_UNVERIFIED; **shape validation is not independent scientific verification**.

## Unit validation

Run these isolated, synthetic-only Node commands:

- node --test tests/de441-smoke-runner.test.mjs
- node --check scripts/de441-smoke-runner.mjs
- node --check scripts/verify-de441-json-bridge.mjs

Ten tests cover invalid calendar and numeric inputs, range boundaries, shell-free subprocess options, timeouts, missing Cargo, failed/malformed responses and scientific correlation. The default npm test glob includes this suite. Real Cargo compilation, DE441 calculations, accurate JPL reference comparisons, Windows/WebView2 checks and full Angular builds remain future acceptance gates. Do not trigger this opt-in CLI from UI redraws, Tauri IPC, a network server or a periodic timer.

No new astronomy algorithms, new dependencies, personal records, secrets, downloaded kernel, license change, deployment, GitHub Actions, release or merge are included.
