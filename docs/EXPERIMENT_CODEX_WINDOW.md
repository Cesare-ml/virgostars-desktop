# Experiment: Codex-style native window (Windows)

Branch: `experiment/codex-style-window`. **Not part of main or any public release.**

## Scope

- Windows: native frame replaced by a 42px custom Angular titlebar, keyboard-accessible minimize/maximize/close buttons, drag region, double-click maximize, and eight native resize hit targets. Tauri 2 Windows-only config enables a transparent WebView with the system Mica backdrop.
- The existing sidebar remains dark for glyph contrast; the titlebar and right panel have a restrained translucent treatment. The astrological chart and its renderer are unchanged.
- macOS/Linux: continue to use their native window decorations; no private macOS APIs, no extra dependencies or permissions.
- Browser preview: the custom chrome is not rendered; it appears only in a native Windows WebView.

## Run and inspect

1. Switch to this branch: `git switch experiment/codex-style-window`.
2. Use the existing VirgoStars Desktop development prerequisites (local sibling packages and staged assets), then run `npm run tauri:dev`. The Tauri CLI automatically merges `src-tauri/tauri.windows.conf.json` on Windows.
3. Validate with `npm test` and `node scripts/verify-tauri-security-config.mjs`. Existing Windows release scripts will pick up the platform override when building from this branch.

Check (on Windows 11): drag empty titlebar areas; double-click to maximize/restore; use the three buttons; resize from all sides/corners; check dark/light theme, initial login, fullscreen/maximized and window sizes near the minimum 850×620. Mica varies with OS version, wallpaper and accessibility settings; on Windows 10 or with transparency effects disabled the translucent UI should degrade to the CSS surface colors.

## Safety and rollback

- The baseline `src-tauri/tauri.conf.json` and CSP are unchanged. The Windows override is strictly validated by `scripts/verify-experimental-window-chrome.mjs`, called from the existing security gate.
- Native permissions are limited to the main window and the six window-control operations (close, minimize, toggle-maximize, is-maximized, start-dragging, start-resize-dragging).
- No automatic merge to `main`. To revert, switch back to `main`. If accepted later, first verify that native window resize, snapping, accessibility, Mica appearance, titlebar buttons and clean Windows/macOS builds behave correctly.

This is an experimental implementation; actual Windows 11 rendering and packaged artifact behavior require a real OS build and visual check.
