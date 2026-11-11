# Agent-ready build order — Offline-first interactive natal workstation

**Owner decision: 2026-11-11.**
All items below are **tasks**, not declarations of finished software. Start by reading [OFFLINE_FIRST_MVP.md](OFFLINE_FIRST_MVP.md), [LIVE_CALCULATION_PIPELINE.md](LIVE_CALCULATION_PIPELINE.md), [OFFLINE_PLACES_AND_TIMEZONES.md](OFFLINE_PLACES_AND_TIMEZONES.md), [OPTIONAL_SYNC_AND_DUPLICATES.md](OPTIONAL_SYNC_AND_DUPLICATES.md), `AGENTS.md` and the open PR stacks.

## Concurrency, branching and safety

- **No new uncoordinated nested PR stacks** for every microtask. At the start inspect open PRs and newest commits. Reuse/upsert relevant draft PR or open one small nonconflicting PR with a documented base. The existing UI chain and separate SQLCipher/outbox chain must not be mixed into main blindly.
- Work only on authorized target repos, as separate PRs where cross-repo changes are required. No GitHub Actions, automatic merges, production changes, real user data, or private artwork. Do not enable features that rely on unfinished astronomy calculations.
- Previous private desktop behavior is only a functional reference. Do not reintroduce obsolete branding/legacy astronomy code or copy implementation/assets.
- Product must work as **guest, completely offline**. Remove old "first login required" guidance before implementing auth. Optional cloud comes after local archive.
- **Do not widen scope** to secondary forecasting modules until these core gates are met. The full feature catalog in separate PR #6 remains a long-term contract; link and reconcile rather than independently rewriting its specialized algorithms.
- Each PR must show exact file diff, tests actually executed vs merely authored, memory/correctness impacts, existing PR/branch overlap, and a next incremental step.

## Ready-to-execute work packages (one verifiable change per PR)

| Order / issue ID | Owner area | Concrete slice | Predecessor and pass condition |
| --- | --- | --- | --- |
| D-00 | Desktop integration | Audit PR #13 generated output contamination, ensure `dist/` and `.angular/` ignored, resolve divergent local merge safely, reconcile #7 UI and CSS fixes #16–18; run real Windows build | Existing .exe launched; styled layout + central large chart pass visual screenshot; no unapproved generated binaries committed |
| D-01 | Desktop/Tauri | **Pure latest-only queue** with mock synchronous/asynchronous Rust port; typed DTOs, bounded pending items, cancellation IDs | 200 rapid inputs/10k stress; no stale final chart, bounded queue; no ephemeris required |
| D-02 | Rust core + Desktop | Versioned synthetic IPC calculation call on dedicated worker (no GUI blocking), time handling and error status; benchmark transfers | Genuine Windows IPC test and response ID/cancellation; synthetic output clearly labeled |
| D-03 | Ephemeris/Functions | Verified local Rust ephemerides for Sun–Pluto, houses and time conversion over declared range; TS astrology functions bridge | Numerical fixtures, no network, no silent fallback; disable unsupported houses |
| D-04 | Charts renderer | Incremental low-GC partial-update API and interactive hover/aspect focus for radix/transits | Constant WebGL scene count after long scrub; no full rerender per time step; clear selection API |
| D-05 | Desktop | Live `Adesso` view, clock seconds, selected location/timezone, accuracy/freshness and pause/resume | Starts without account/Internet, wakes from sleep correctly, uses validated provider only |
| D-06 | Desktop | Year/month/day/hour/minute correction controls + hold-to-repeat and preview/reset/save | Press/cancel/pointer capture/blur/DST tests; latest result wins; preview does not edit saved chart |
| D-07 | Places + Desktop | **Full purchased 1,951,599-city SQLite catalog chosen.** Use [LOCAL_CITY_PACKAGING.md](LOCAL_CITY_PACKAGING.md) and [sizing data](OWNED_CITY_CATALOG_SIZING.md): private PostgreSQL CSV → FTS5 SQLite + SHA-256 → Tauri resource; Rust bounded read-only search IPC and TS contract now drafted ([native bridge](NATIVE_OFFLINE_PLACES.md)); Angular local autocomplete is now coded in Settings/Parametri; next validate native package, import/verify source state-country mapping (v2, see [Owned Country Lookup](OWNED_COUNTRY_LOOKUP.md)), resolve historical TZ and persist selected city in guest archive, join country/state lookup and historical tzdb | Exact full row count; measured SQLite/ZIP bytes, verified legal provenance, correct country/region/coordinates/TZ, offline first start, Windows native installer and search performance without network |
| D-08 | Desktop storage | Local guest profile archive: an **unsaved natal draft UI** and pure civil-time validation have been authored ([natal draft v1](NATAL_DRAFT_V1.md)); next connect reviewed SQLCipher native create/save/open/edit/delete/duplicate/search groups/notes | Crash-safe transactions, stable IDs, no login and no hidden sync; data survives restart |
| D-09 | Desktop/Functions/Charts | Natal chart with separate live/adjustable transit ring; hover from either ring shows cross-ring aspects | Radix stays fixed, accurate aspects/valid orbs, keyboard equivalent |
| D-10 | Desktop settings | House picker + body/aspect/orb/aspetti-verso controls, graphical layers + light/dark; locally persisted presets | Changing skin doesn't invoke astronomy; unimplemented house IDs disabled with status; reload retains settings |
| D-11 | Integration | Acceptance: offline app from first install, archive + current sky + correction + transits + settings | Windows native tests, screenshot, memory/GC, provider accuracy, licensing and profile backups all recorded |
| D-12 | Optional cloud (P1) | Login PKCE → metadata inventory → explicit duplicate preview → idempotent outbox sync | Only after D-08/D-11; Keep both as safe default; cloud cancel/failure never blocks local work |

**Owners must not open D-12 as if it were a prerequisite to D-05/D-08.**

## Important cross-repo contracts to coordinate

- Rust ephemeris dependency must be a locally distributed capability with a declared accurate range and version, not an HTTP wrapper. Offline kernel/package availability gate is explicit.
- `astrological-functions` computes astrology-specific logic from injected Rust astronomical results. Timezone lookup and city selection are separate from ephemeris math.
- `astrological-charts` owns incremental graphics, angular geometry rendering, hit-testing and chart-to-UI events. The desktop owns UI control state and Tauri IPC.
- `VirgoStars` online remains owner of user account authorization and persistent server records; backend changes need their **own** approval, tests and migrations.
- Shared data DTOs must be versioned, deterministic, validated and licensed appropriately; do not import unrelated production schemas.

## Definition of done for early user value

- **Guest and offline:** on a fresh offline Windows installation, choose a city from local data, compute valid current chart (not demo), create and save a chart, relaunch and reopen it, correct it rapidly and compare with real-time transits.
- **Quality:** both skins match approved chart-first UI direction; zoom/fit, responsive panel collapse and mouse/keyboard controls keep the chart as large as possible.
- **Accuracy:** Swiss-reference comparisons serve as **tests only**, not runtime dependency. Every supported house method/body/epoch reports tested accuracy; no invented output.
- **Performance:** measure latency/RAM/queue/renderer reuse on an ordinary supported laptop, not only high-end development hardware. 60s hold and 10k events never create unbounded queue or GPU resources.
- **Data protection:** local archive survives crash, old/new data versions, optional login failure and disconnection. Confidentiality/security must be reviewed before saving real subjects if using encryption.
- **Release:** signed Windows installer, public licensing and cloud sync are separate approval gates; do not mislabel a synthetic demo as an MVP.

## Document change-control

A future agent discovering contradictory documents must preserve the **2026-11-11 guest/offline-first decision** over older drafts that required a first online activation; update those documents rather than quietly implement forced login. Reference long-term [scope PR #6](https://github.com/Cesare-ml/virgostars-desktop/pull/6), UI design PR #2 and the current desktop PR stack without merging them automatically.

Names used in files/screens/products must be **VirgoStars Desktop**. Do not introduce historical product branding into VirgoStars docs, UI, installers or about/credits.
