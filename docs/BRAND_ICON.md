# VirgoStars Desktop — official app icon

The Tauri native app icon is the original gold/ivory circular VirgoStars emblem supplied by the project maintainer on 18 November 2026. The transparent original was mechanically resized and placed on a dark `#101726` square; no synthetic icon generator or AI redraw is used for distributed assets.

Source assets under `src-tauri/icons/`: `icon.png` (512), `icon.ico` (Windows multi-resolution), `icon.icns` (macOS), plus 32/128/256px PNG variants. `npm run prepare:icon` performs read-only signature and dimension checks; it no longer creates a temporary placeholder icon.

The macOS ICNS is packaged from those same approved PNGs with `node scripts/package-brand-icns.mjs` when the artwork changes. This manual operation does not redraw or alter the glyph. The read-only verifier checks ICNS size and chunk boundaries to detect truncated files before a native build.

`bundle.active=false` is unchanged. The icon is included in future Tauri builds, but a new executable or installer must be built to see the update. Validate Windows taskbar, Start Menu, desktop shortcut, NSIS installer and both light/dark backgrounds on an actual Windows system. macOS packaging still requires platform-specific verification.

Trademark/brand artwork is maintainer-supplied and distinct from the software CPAL-1.0 source license; preserve its provenance when reusing it.
