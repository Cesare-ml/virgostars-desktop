# Fictional geometry contract for the offline desktop prototype

**Status:** isolated synthetic fixture hardening, not astronomical computation (2026-11-13).

The desktop-only Angular demo intentionally shows **fictional** planets and houses while the real Rust ephemeris, astrological functions and local encrypted profiles are developed separately. No position in this fixture is a validated calculation of a real birth chart.

## Contract

- `src/app/fictional-geometry.ts` owns the ten fixed demonstration planet longitudes and the twelve equally spaced *fictional* house cusps. The existing base demo remains unchanged (`shift = 0`); current overlay shifts are `23` and `58` degrees.
- All synthetic longitudes are finite, normalized to `[0, 360)`, and canonicalize negative zero to zero. Non-finite input throws before a `TemaRender` is constructed.
- ASC/DSC and MC/IC remain 180 degrees apart; the synthetic vertex and house cusps are derived from the same ascendant as the chart. This is **fixture consistency only**, not a real house-system implementation.
- The returned pure geometry and its arrays are immutable to protect test fixtures from accidental reuse. `fictional-fixture.ts` passes a **mutable copy** of the cusps to the third-party renderer to preserve its previous API expectations.
- Inspector planet and house tables both use the same `shift = 0` coordinates as the base natal diagram. The transits, synastry and latitude modes may have other overlays; the base inspector must not be presented as an interpretation of those overlays.
- `buildFictionalAngles` is not a general coordinate validator for imported real-person data. Real astronomy must come from the canonical Rust VirgoStars-Ephemeris engine, with its own accuracy and provenance gates.

## Verification performed

- Node.js 22.16.0, TypeScript strip-types runner: **six synthetic unit/contract tests passed** in an isolated fixture mirror using `node --experimental-strip-types --test tests/fictional-geometry.test.mjs`.
- TypeScript 5.8.3, strict standalone `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler src/app/fictional-geometry.ts`: **passed** in the same mirror.
- The full repository `npm test`, Angular strict build against the sibling Charts package and Windows Tauri/WebView2 runtime have **not** been run in this isolated environment. Run them on an authorized checkout before merging.

## Security, licensing and release boundaries

This change has no network, login, storage, database, user location, birth data, update, native IPC, bundled artwork, dependencies, public visibility or license changes. It does not make the desktop application ready to release. Keep the PR as draft until full tests, renderer compatibility and Windows visual acceptance are complete.
