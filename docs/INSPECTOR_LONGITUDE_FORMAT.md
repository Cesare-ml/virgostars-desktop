# Inspector longitude display guard

Status: **Locally tested as a standalone pure formatter**. The full Angular/Tauri application remains an experimental synthetic demo.

## Scope

The planet and house inspector rows in the current synthetic chart shell now use `src/app/format-longitude.ts` instead of formatting arbitrary numbers with direct `toFixed(1)`.

- Accept only finite source ecliptic longitudes in **[0, 360)** degrees.
- Render invalid, missing, untyped or out-of-range runtime values as **—** (unavailable); never render `NaN°` or `Infinity°`.
- Round to one decimal **for display only**. A valid near-360 value that rounds to 360.0° is displayed as 0.0° at the circular boundary.
- Do not coerce strings, perform astronomical calculation, validate ephemeris accuracy or normalize values outside the accepted range.
- No network calls, user records, profile storage, new native commands, credentials, dependencies or asset rights changes.

The formatter is intentionally limited to ecliptic longitudes in the inspector; do not apply it blindly to signed declination, latitude, house arcs or orbital speed.

## Reproducible narrow checks

Using Node.js 22.16.0 and TypeScript 5.8.3, run:

```sh
node --experimental-strip-types --test tests/format-longitude.test.mjs
tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/app/format-longitude.ts
```

Four standalone Node tests passed locally and TypeScript standalone compilation passed. **Not executed here:** the complete `npm test` suite, Angular build, Rust/Cargo, Windows Tauri/WebView2 GUI, or inspection with real ephemeris data.

## Integration

The branch changes one import and the `formatDegrees` method in `src/app/desktop-app.component.ts`. Reconcile with concurrent UI/natal/CSV PRs that edit the same component before merge. Keep the synthetic provenance labels and credit notices. No main merge or release is included.
