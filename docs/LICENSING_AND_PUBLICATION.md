# Licensing, required attribution and source publication

**Decision (2026-11-12):** CPAL-1.0 is selected for original VirgoStars Desktop source. This aligns with the attribution-oriented licensing approach used by VirgoStars Ephemeris. The GitHub repository is **not automatically made public** by this decision, and no installer or user database is published.

## What is covered

The unmodified full [LICENSE](../LICENSE) contains the Common Public Attribution License 1.0, with a Desktop-specific completed Exhibit A and Exhibit B. Original project source and copyright notices follow that license; third-party packages and data retain their own independent terms. See [NOTICE](../NOTICE).

**Exhibit B attribution:** Copyright (c) 2026 Cesare-ml (VirgoStars project); phrase **Powered by VirgoStars**; URL https://www.virgostars.it/; no required graphic image. CPAL Section 14 can require a prominent display at application launch/session, including larger works. An About link alone cannot always replace that notice. The current prototype includes the attribution in its GUI footer; review visibility in all window sizes and platforms before release. Section 15 includes source-availability obligations for external deployment.

CPAL permissions are not a trademark license for the VirgoStars name, visual identity or associated services. Do not claim that third-party software, data or imagery is licensed by the Desktop CPAL merely because it is referenced in documentation.

## Materials outside this code license

- Original branded artwork, fonts, imported icons and privately approved visual packs are subject to separate permission/provenance reviews.
- Purchased or licensed world-city records and any generated SQLite or ZIP package are **not** automatically redistributable. The protected `places-20261112-v2` release currently includes `world-cities.zip`. **Do not make this repository public while that asset remains attached to an accessible release.**
- NASA/JPL kernels, Swiss Ephemeris materials and any independently acquired scientific datasets require their own distribution-rights assessment.
- Hosted VirgoStars account, API backend, personal data, credentials and signing keys are not included in the license grant.
- Standard npm/Rust/Angular/Three.js dependencies retain their own terms. Before distributing binaries, inventory the full resolved dependency tree and preserve all required third-party notices.

## Open-source distribution controls

1. Verify legal authorship of original files and third-party license compatibility; confirm the whole repository history is safe to expose, not only the current branch.
2. Relocate or remove the protected city release asset and check other releases, tags, attachments and generated bundles.
3. Check every committed file and Git history for credentials, internal endpoints, private source, personal records and unapproved art. Revocation/secret rotation may be required if leaks ever occurred.
4. Ensure the synthetic build can run using publicly available dependencies only; do not publish optional private-only assets or credentials.
5. Verify CPAL source-availability, GUI attribution, LICENSE/NOTICE, lockfile dependency licenses and native installer contents.
6. Only after a maintainer accepts [Publication Checklist](PUBLICATION_CHECKLIST.md) should GitHub visibility be changed manually. Changing visibility is not a code-review step or implied by merging this documentation.

This document records an engineering licensing choice, not an individual legal opinion. The complete license governs.
