# VirgoStars Desktop — interactive UI layout prototype

**Status:** self-contained, offline, visual layout preview only. **Not** the finished Angular/Tauri UI and **not** an astrological renderer.

## Open it on Windows (no installation)

In Windows File Explorer open `docs\\ui-prototype\\index.html` directly with Edge or Chrome. This example does **not** need a VirgoStars account, Node, Rust, a backend, or an internet connection.

Try switching **light/dark**, collapsing the sidebar and right inspector, selecting chart modes/inspector tabs, resizing the window, and using **Zoom +/-** and **Adatta**. Below 1181 px, the left menu becomes a narrow icon rail; use the menu button to open a temporary navigation drawer without reducing the chart. Press **Escape** or click outside the drawer to close it; the inspector also closes with Escape. In inspector tabs, the arrow keys and Home/End navigate the tab strip. The central circular placeholder intentionally has **no invented planetary positions**; a real wheel must come from `astrological-charts` and validated libraries.

## Run automated layout tests

With Node 20+ installed, from the repository root:

```powershell
node --test tests/ui-shell-layout.test.cjs
```

The test checks all target desktop widths, square chart fit, invalid dimensions, theme token parity and offline/no-external-resource assumptions. These are **layout contract tests**, not an actual WebView2/Angular build, visual diff, accessibility audit or astronomical correctness test.

## Architecture and follow-up

- `chart-sizing.cjs` is a tiny dependency-free sizing contract reusable for a preliminary Angular chart container (not an astronomy algorithm).
- `styles.css` proposes real light/dark semantic CSS variables aligned with `../UI_DESIGN_GUIDELINES.md`.
- The dummy chart must be **replaced**, not expanded into a second renderer, when Angular hosts the actual `astrological-charts` component.
- The native Windows app remains on a separate Tauri proof-of-concept branch; no change here touches production, authentication, sync or packaging.
- Before any public documentation or distribution, ensure example subjects in every visual/reference are synthetic or explicitly approved.
