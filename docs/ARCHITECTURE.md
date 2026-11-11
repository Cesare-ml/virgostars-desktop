# VirgoStars Desktop — proposed system architecture

Status: **DESIGN WITH EXECUTED WINDOWS SYNTHETIC GUI SMOKE** (updated 2026-11-11). A first experimental Tauri .exe launched on Windows with synthetic Three.js chart and native runtime IPC; actual astronomical computation, local persistence, full CSS visual acceptance, optional accounts and cloud sync are not integrated.

## Product principles
- Dedicated workstation for professional astrologers and researchers, not a web wrapper.
- First launch, current sky, local calculation, city search, chart creation and saved archive work **without any VirgoStars account or online activation**. A later optional account connects for server-side sync and conflicts, without blocking local usage.
- Local-first: guest local edits save atomically; after optional account linking, offline edits also create durable pending sync operations. Network reconnection is eventually consistent and never erases local work.
- Site and Desktop share user-owned entities via future, scoped, versioned APIs, not direct PostgreSQL access.
- Windows first, future macOS, with multiplatform shell and storage abstraction.
- Code can become public after licensing/privacy/rights review; repo remains private for now.

## Component map
```text
                   VirgoStars web / existing backend / PostgreSQL
                                        |
                NEW versioned API: device auth + entity sync + cursor
                                        |
                                  HTTPS (TLS)
                                        |
+------------------------- VirgoStars Desktop -------------------------+
| Tauri 2 Rust host                                                    |
|  SecureStorage | Native EphemerisProvider | LocalRepository | Sync   |
|    |                    |                        |          |        |
|    |             VirgoStars-Ephemeris         SQLite       Outbox    |
|    |             (Rust canonical core)         DB                    |
|    +--------------------- typed Tauri IPC ---------------------------+
|                                |                                      |
|        Angular / TypeScript application UI                            |
|        astrological-functions (domain calculations; provider adapter) |
|        astrological-charts (Three.js renderer) + approved assets       |
+-----------------------------------------------------------------------+
                      |
              Optional future integrations:
           VirgoStars-Event-Ephemeris, Python exports/scripts
```

## Why the boundaries matter
- **Ephemeris:** astronomical coordinates/time models from the independent Rust engine; official kernels need provenance/availability checks. Not presently production-ready.
- **Astrological Functions:** aspects, zodiac, houses, natal/transits etc. TypeScript package; astronomy is injected, not reimplemented.
- **Charts:** receives typed results and only renders the diagram; upstream renderer still has browser/global WebGL lifecycle and asset-validation constraints.
- **Desktop host:** local database, operating-system integration, sync scheduling, update verification and secure credentials.
- **VirgoStars online:** authentication, user ownership authorization, central records and conflict-resolution semantics. Existing production REST v1/OAuth support is not assumed available.
- **Assets:** separately approved/licensed, integrity-verified; repository visibility does not grant permission to redistribute image packs.
- **Event Ephemeris:** optional and future; its proposed reader/dataset is not an implemented or licensed public binary yet.

## Proposed workspace boundaries (folders are not created yet)
```text
src/                     Angular UI
src/app/features/        chart, library, research, settings, sync
src/app/shared/          typed UI contracts; no OS permissions
src-tauri/               Rust host and strict Tauri capabilities
src-tauri/src/auth/      browser OAuth callbacks + secure token storage
src-tauri/src/storage/   local persistence/migrations
src-tauri/src/sync/      durable outbox and pull/push synchronization
src-tauri/src/astro/     canonical Rust ephemeris bridge
src-tauri/src/update/    signed update coordination
contracts/               versioned DTO schemas and synthetic examples
tests/                   synthetic integration/contract/security cases
docs/                    approved decisions and plans
```

## Workstation UX
- Large interactive chart workspace with dockable/tabbed panes; natal/transit/synastry comparisons as upstream capabilities mature.
- Local guest library with search, groups, notes, reliable export and settings; optional account-linked profiles add clear pending/synced/conflict indicators only after deliberate connection.
- Multiple windows/screens are an **advanced goal**, not a v1 promise: the upstream renderer uses some shared global rendering state and must be isolated/tested first.
- Never present fake precision: missing kernels, unsupported house systems, absent birth times and unavailable calculation types display explicit capability/accuracy warnings.

## Immediate architecture priorities (2026-11-11)

- [Offline-first usable MVP](OFFLINE_FIRST_MVP.md): current sky and clock, continuous date/time corrections, natal charts, local archive, transits, settings and Light/Dark skins **without any account**.
- [Live Angular–Rust calculations](LIVE_CALCULATION_PIPELINE.md): bounded latest-only IPC/worker scheduling; distinction between UI fps and ephemeris throughput; no unbounded memory or WebGL resources; numerical parity fixtures.
- [Offline places and timezone rules](OFFLINE_PLACES_AND_TIMEZONES.md): local indexed city search and historical tzdb, manual coordinates, optional online enrichment; no GPS assumption.
- [Optional sync/reconciliation](OPTIONAL_SYNC_AND_DUPLICATES.md): local-first IDs and per-account mapping, first-link inventory preview, safe keep-both default, no silent name-based merges.
- Core engine remains Rust `VirgoStars-Ephemeris` with `astrological-functions` composition and `astrological-charts` incremental updates; no runtime requests to third-party ephemerides.

## Design constraints / open questions
1. Server routes/auth still require a separate production-safe backend change and migrations; treat them as *not built*.
2. Determine whether a Rust-native and/or a Rust-WASM ephemeris adapter is the least redundant and best tested boundary.
3. Validate WebView2 Three.js and macOS WKWebView; capture resource/memory/graphic metrics before final tech decision.
4. Local database encryption approach (encrypted SQLite engine vs envelope encryption) and key rotation must be tested.
5. Separate persistent **guest local** access from future **optional cloud** authorization/revocation; define exact cloud account inventory and opt-in sync behavior without imposing an offline grace period on guest charts.
6. Isolate schema/renderer package versions; no silent switch of web or Astrolabio dependencies.

## Isolated proof-of-concept boundary

[Spike 001](SPIKE-001.md) temporarily hosts the **existing upstream demo application** in Tauri for WebView2/offline packaging verification. This is not the intended final Angular workspace: the proper desktop-owned layout and runtime package adapter follow only after hardware testing. Its content is fictional and generated locally.

## Cross-repository readiness as of 2026-11-10
- VirgoStars-Ephemeris: Rust DE441 reader/prototypes, no validated full astronomical engine or bindings.
- astrological-functions: experimental pure-math features / injected provider, not production-compatible complete charts.
- astrological-charts: Angular/Three.js build and synthetic demo; original artwork and production visual parity not validated.
- astrological-assets: private approved pack for private use; public redistribution rights must be explicitly finalized.
- VirgoStars-Event-Ephemeris: design and documentation only; datasets and reader not released.
- virgo-stars: production web/backend exist, but proposed versioned desktop auth/sync API is not available yet.

## Engineering rule
Architecture sketches are not evidence of functionality. All integrations require real compiled builds, synthetic fixture tests, documented compatibility and maintainer approval before production or releases.
