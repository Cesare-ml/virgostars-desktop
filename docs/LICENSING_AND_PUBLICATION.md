# License, credits and eventual public release

Status: **UNDECIDED** (2026-11-10). The owner explicitly requested that the license be determined later.

## Current rule
**Do not add LICENSE, imply license permissions for the private code, or make this repository public yet.** Public GitHub visibility alone does not create an open-source license; selecting a license requires an explicit maintainer decision and dependency review.

## Invariants for future public release
- Aim for genuinely free/open-source source code, with no paywall to study, run, modify or redistribute.
- The official VirgoStars cloud account and hosted services remain separate from the open-source desktop client. Requiring official login to use VirgoStars cloud should not be presented as a universal technical restriction on third-party forks.
- Display correct attribution and links to VirgoStars under all imported licenses. Never represent NASA/JPL, other upstream projects or Astrodienst as endorsing VirgoStars.
- No user data, client secrets, private backend code, copyrighted/unapproved assets, controlled credentials or independently restricted kernel files in a public commit.
- Contributions and copyright ownership must be tracked, especially if future relicensing is contemplated.

## Options to assess
| Option | Benefit | Caution |
| --- | --- | --- |
| CPAL-1.0 (used by VirgoStars-Ephemeris) | Attribution-related provisions and sharing obligations, consistent with some upstream repositories | Network use and interface notice duties, contributor rights, copyleft boundaries; legal review needed |
| MPL-2.0 | File-level reciprocal license, widespread developer familiarity | Does not on its own impose a custom VirgoStars branding link in each application's UI |
| Apache-2.0 / MIT | Broad adoption, simpler reuse | Branding/credit requirements primarily notice retention; no special mandatory interactive About link without separate conditions |

**Important:** `VirgoStars-Ephemeris` and `VirgoStars-Event-Ephemeris` already use CPAL-1.0 for their *original code*. Their requirements, including the actual Exhibit B and Section 14 notice obligations for GUIs where applicable, must be respected regardless of the desktop application's chosen license. An About page link alone is not a guarantee of satisfying CPAL Section 14. Other imported packages and binary datasets retain their own licenses.

`astrological-charts`, `astrological-functions`, `astrological-assets` remain private/not universally licensed for public reuse according to their current docs. Public packaging is blocked pending provenance and authorizations. No automatic copying of asset pack into a public app.

## Before a license decision
1. Audit dependency and font/image provenance, dynamic/native Rust linkage, npm packages, binary datasets and author permissions.
2. Clarify desired attribution: visible at app launch vs Credits/About, link placement, use of trademark.
3. Document required notices, source availability, distributed binaries, network service/fork policy and contributors' rights.
4. Seek legal review if trademark and CPAL obligations are business-critical; then add the approved full LICENSE, NOTICE, third-party notices and contributions policy in a dedicated authorized PR.

No legal opinion is offered here; full license texts govern.
