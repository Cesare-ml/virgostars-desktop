# Switchable fictional chart presets — Desktop laboratory

**Status:** experimental synthetic-only UX increment; not an astronomical calculator.

## Behavior

The chart toolbar now includes a keyboard-accessible **Sample A / B / C** control.
Each click cycles to the next fictional, hard-coded example. The active example is
also shown in the Settings inspector. All three examples use deliberately invented
positions: `0°`, `45°`, and `120°` shifts of a fixed demonstration fixture.
This is **not** an ephemeris, birth chart, house calculation or astronomical test.

`src/app/demo-presets.ts` is a pure, deterministic, network-free source of:
- an allowlisted three-preset ID and translation label;
- a 10-planet synthetic longitude table and 12 synthetic house cusps;
- fictional Ascendant / MC angles.

`src/app/fictional-fixture.ts` builds renderer-owned `TemaRender` objects from
the **same** pure helper used to populate the planet and house inspector tables.
Changing a sample rebuilds the natal fixture and its two fictional overlays,
clears a previously selected inspector planet, and invokes the existing
generation-guarded renderer redraw. The button is disabled when rendering,
not ready, or when export is busy; no input is captured from the user. The
default sample A preserves the original synthetic numbers. Neither the sample
nor any chart data is persisted or sent to VirgoStars.

The control is for exercising the native Three.js rendering path with
different inputs while full Rust Ephemeris integration is unavailable. It
does **not** enable the currently disabled archive, account, research or
cloud features.

## Verification

From a clean authorized checkout:

```sh
node --experimental-strip-types --test tests/demo-presets.test.mjs
npm test
npm run build:ui
```

The focused test checks deterministic cycling, strict preset ID allowlist,
immutability, original default values, independent sample positions,
normalization to [0,360), invalid offsets, fresh arrays, and static Angular
wiring. Test the complete app manually in Windows WebView2: wait for the
original chart, activate the cycle button using pointer and keyboard, inspect
planets/houses, toggle themes and modes, rapidly resize the window, export
a synthetic PNG from each sample, and ensure no stale renderer state or
sample mismatch appears. Verify IT/EN labels and inspect offline network
requests. **The source-level checks alone do not certify any renderer output.**

## Safety / integration

No personal birth data, localStorage/sessionStorage records, real astronomical
values, credentials, backend routes, production calls, native commands, asset
rights changes, dependency updates or installer/release. The only persisted
UI preferences remain the existing theme/language choices.

The experimental component and translation catalog are also edited in
other draft UI PRs. Reconcile against current main and execute the full
Node/Angular/Windows acceptance gates before merge. Do not enable GitHub
Actions or change source-repository visibility while the protected city
catalog release remains attached.
