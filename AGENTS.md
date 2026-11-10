# VirgoStars Desktop — Agent Instructions

## Scope and current state

This is a **design-stage, private repository** for a future offline-first professional desktop app. Read `README.md` and `docs/UI_DESIGN_GUIDELINES.md` before changing UI, screenshots, architecture or navigation. The accepted visual direction is documented there and illustrated by `docs/design/virgostars-desktop-light-reference.webp`.

**Product branding:** VirgoStars Desktop only. Do not introduce unrelated product/module brands, including from illustrative design samples, into any code, UI strings, assets, docs, release metadata or generated screenshots.

## UI work rules

- The main astrology wheel is always the largest and most prominent element, centered within the usable chart workspace; preserve its fit and center through resizing, panel toggles and selection.
- Deliver paired light and dark theme support with shared semantic design tokens. Keep layout and information architecture identical across modes.
- Keep chrome compact and panels collapsible; avoid visually heavy gradients, glow, unnecessary animation or decorative distractions.
- Use only approved/licensed astrology glyphs and assets. Coordinate asset ownership with the `astrological-assets` repository; do not import private assets into publicly distributable content.
- Astronomical computations belong in `VirgoStars-Ephemeris`, astrology calculations in `astrological-functions`, chart rendering in `astrological-charts`. Do not duplicate algorithms in the desktop shell.
- Concept screenshots do not validate the data shown. Use synthetic test data for demos and never use real production accounts or user birth records.
- Test keyboard navigation, contrast, resize, 125%/150% scaling, missing birth time, live/pause states and Italian/English localization when implementing relevant UI.

## Contribution and safety workflow

- Work on a dedicated branch and in a pull request; read existing docs, issue/PR state, and avoid duplicate work.
- Make changes in small, verifiable units; add tests/snapshots and user-facing notes for actual implemented work.
- Report clearly what is implemented, proposed, mocked, tested or blocked; do not mark planned functionality as production-ready.
- No GitHub Actions automation, production deployments, account/auth changes, migrations, repository visibility changes, LICENSE additions or releases without explicit maintainer approval.
- The future open-source license has **not** been chosen; maintain the current repository constraints.
