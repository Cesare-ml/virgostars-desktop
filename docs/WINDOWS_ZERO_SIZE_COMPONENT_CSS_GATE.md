# Zero-size CSS layout overrides — Windows offline bundle gate

**Status:** Prototype / isolated JavaScript verification. This is a static build-artifact heuristic, **not** confirmation that Windows WebView2 loaded or applied CSS.

## Why this gate changed

The compiled Angular component-style audit already rejects unexpected layout-root `display` changes, `visibility:hidden` and `opacity:0`. However, a later CSS rule such as `.chart-stage{height:0}` can make the chart invisible or tiny **while all three mandatory layout roots still declare `display:grid`**. Such an override previously passed the artifact check.

The existing `hasDesktopLayoutOverride` function now rejects zero-valued `width`, `height`, `max-width`, or `max-height` declarations on **the three existing reviewed root selectors only**: `.desktop-app`, `.workspace`, and `.chart-stage`, including recognized Angular-scoped selectors, direct class variants and supported `:is`/`:where` wrappers. Conventional CSS zero units (`0`, `0px`, `0rem`, `0%`, etc.) and an optional `!important` are recognized. Rules in a responsive `@media` block are checked as part of the existing scanner. Because the scanner examines the emitted CSS and JavaScript candidates, a later split chunk cannot hide such an override.

Intentional `min-width:0` and `min-height:0` remain valid: they allow grid/flex children to shrink. Rules applying only to descendants, such as `.workspace .nav-label{width:0}`, remain valid. No Angular component templates, real UI preferences, stylesheet content, CSP or native capabilities were changed.

## Reproduction / verification

Three new Node test groups were added to the **existing** `tests/verify-component-styles.test.mjs`:

- Five rejected zero-size override patterns, both standalone and inside a responsive rule.
- Five accepted noncollapsing root and descendant patterns.
- An integrated synthetic bundle fixture where a later `chunk-*.js` contains a zero-sized chart rule.

The exact committed verifier source was loaded into an isolated V8 harness and its exported pure layout-classification functions were exercised in **14/14 passing cases** (baseline, five blocked zero-size rules, five safe rules, three pre-existing bad overrides). The authored filesystem-backed Node test groups and full existing `node:test` file were **not executed in that harness**. No Angular or Tauri build was performed.

From a full authorized checkout:

```powershell
node --test tests/verify-component-styles.test.mjs
npm.cmd test
npm.cmd run build:ui
npm.cmd run verify:bundle
```

On Windows 11, inspect the **actual** WebView2 computed styles, displayed chart dimensions and applied global/component CSS at 100%, 125%, 150% and 200% scaling. This change does **not** solve a missing WebView stylesheet, staleness of a previously compiled `.exe`, dynamic runtime style changes, or every way CSS can collapse a layout. Keep `docs/WINDOWS_GUI_SMOKE_2026-11-10.md` acceptance items open until native evidence is available.

## Risk and boundaries

No new dependency, native bridge command, personal record, approved-asset change, database, account, cloud synchronization, astronomy engine, backend service, production access, GitHub Actions, license, visibility change, installer, binary release or main merge. Static regex heuristics may conservatively block unusual legitimate CSS changes; manual review is required before changing layout contracts. Coordinate with active CSS/build-gate PRs before integrating.
