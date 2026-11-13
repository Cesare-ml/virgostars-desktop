# Inspector keyboard navigation

**Status:** implemented on an isolated desktop draft branch. This is a UI accessibility improvement for the synthetic demo, not an astronomy or cloud-sync feature.

The inspector has three tabs: Planets, Houses, Settings. While focus is on a tab:

- **ArrowRight / ArrowLeft:** select and focus the next / previous tab, wrapping at either end.
- **Home / End:** select and focus the first / last tab.
- **Tab / Shift+Tab:** follow native browser tab order; only the selected tab is in the sequential tab order.
- **Enter / Space:** retain native button activation behavior.

The UI switches panel content immediately with no remote or native IPC call. Modified keys and in-progress IME composition do not trigger tab-navigation shortcuts. A visible focus outline uses the current theme's `--vs-focus` token. Each tab retains `aria-selected`, `aria-controls`, and the shared panel retains `aria-labelledby`.

Pure unit tests: `node --experimental-strip-types --test tests/inspector-tab-navigation.test.mjs`.
The helper was tested on Node.js 22.16.0 (5 passing tests). Full Angular compilation, screen-reader review, Windows WebView2 keyboard/IME testing, and a complete native desktop build have **not** been run for this change.

**Security/privacy:** no birth details, credentials, storage, IPC, network traffic, dependencies, astronomical claims, new assets or licensing changes. The original CPAL/NOTICE attribution is untouched.
