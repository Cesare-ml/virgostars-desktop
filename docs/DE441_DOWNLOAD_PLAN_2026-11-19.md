# DE441 packages in VirgoStars Desktop — 2026-11-19

**Status: staged implementation of the private 1000–2200 installer default
only. Downloads, first-run selection, package settings UI and multipack
astronomical provider are not integrated or released.**

## Product contract

1. A private, locally prepared Desktop installer is expected to carry a
   mandatory classic-DE441 slice for astronomical years **1000–2200
   inclusive**. The staging script now defaults to those years, and the
   release preflight rejects any staged manifest that fails to state
   complete base coverage. The former 1890–2110 private bundle is no
   longer acceptable for a *new* installer under this profile.
2. The separately proposed v2 catalog in
   [Ephemeris PR #649](https://github.com/Cesare-ml/VirgoStars-Ephemeris/pull/649)
   contains a base and adjoining 200-year optional blocks. It remains
   distinct from Mobile's ten v1 blocks. Rust in the ephemeris core
   provides the authoritative gap-free expansion/removal planner.
3. On first app launch, after the offline base is available, offer
   optional **Standard**, **Historical**, **Complete**, **Custom**.
   Custom chooses two year limits; the host computes the *entire*
   intervening download queue and shows size/disk requirements before
   asking for confirmation. First-run choices are also available later
   under **Settings → Effemeridi**.
4. Standard and user-installed optional packs continue to work offline;
   no login, external IP check or online service is required to query a
   previously validated interval. An app update must preserve them.

## Architecture still required

- Application-owned storage: use the platform-specific Tauri local data
  directory, not the installation/executable directory, for optional
  packages and download state. Keep base resources read-only. Verify
  each local package against an approved, immutable manifest and identify
  active sets by both source fingerprint and catalog version.
- Host API: status (verified JD TDB range, available optional years,
  per-pack bytes/state), plan extension (ordered package IDs and summed
  sizes), start/cancel/resume download, and remove edge package. Native
  commands must be explicit and permission-scoped; never accept arbitrary
  URLs or file paths from the WebView.
- Transport: allow only an authenticated release catalog tied to an
  embedded trust key/version, approved public GitHub release asset URLs,
  expected length and SHA-256. Pin the exact downloaded data generation;
  do not silently mix newly released coefficients with an older core.
  Download to a local staging file with bounded memory, check free disk,
  recover interrupted downloads where safe, verify before atomic
  activation, and do not mark partial files installed.
- Continuity: only a validated contiguous interval containing the base
  is active. If an optional prior range is requested, queue each bridge
  in order from the current edge. Failures leave the older active
  coverage unchanged. Uninstall is allowed only at an optional edge,
  never in the middle or inside the required base.
- Native provider: today VirgoStars Desktop holds one
  De441<File> for its optional experimental chart provider. The app
  must adopt a **reviewed multipack apparent provider** once the
  upstream core and its typed missing-emission/refinement diagnostics
  are integrated (see Ephemeris PR #631). Do not fake a unified file
  by concatenating binary parts or silently fall back to another model.
- UX: show available interval, downloaded space, missing range, progress,
  pause/cancel, errors (offline, disk full, broken hash, unavailable
  dates) and a confirmation before any large transfer or deletion.
  No download begins merely because a chart is opened.
- Historical safety: JD TDB coverage is distinct from supported
  civil-time/Delta-T conversion, house systems and independently
  validated precision. The chart interface must not claim it can
  calculate accurate historical birth charts solely because a
  DE441 coefficient slice covers the date.

## Current private-build staging

The existing local-only script is still:

    node scripts/ephemeris/prepare-data-bundle.mjs FULL.eph USNO_DIR CHIRON.bsp
    node scripts/ephemeris/verify-staged-data.mjs

It **does not** fetch data or publish an installer. Its default
range is 1000–2200, while explicit wider bounds may be supplied for
private tests. The new v2 staging manifest stores the validated
year-profile metadata along with the existing per-file hashes. The
previously tested Windows private installer remains 1890–2110 until
the maintainer rebuilds it from a separately supplied local file.
No source or generated JPL kernel is committed or included in this PR.

## Release and validation gates

1. Ephemeris #601/#649 and the relevant apparent multipack provider
   need Rust checks, real full-source comparisons, independent JPL/NAIF
   reference checks, and upstream integration review.
2. Confirm actual classic DE441 coverage and prepare files from the
   operator-held source outside Git. Record checksums and segment
   boundaries; retain same-source versus independent checks separately.
3. Review JPL/NAIF kernel redistribution and all additional USNO,
   Chiron and art-data rights before any installer or GitHub release.
4. Establish signed/approved download manifest and immutable release
   asset publication. No current local unsigned manifest is an
   authorized download feed.
5. Native Windows test: base present on cold offline launch, custom
   backward+forward expansion, HTTP interruption/cancel/resume,
   corrupted or missing package, app update, restart and uninstall
   edge protections. Later repeat on macOS and Android as relevant.

Modification record 2026-11-19 (CPAL-1.0 §3.3): original Desktop
installer-staging metadata and tests, with product/runtime integration
specified as future work. No external data, credentials, live transport,
new Tauri permission, release or deployment is part of this increment.
