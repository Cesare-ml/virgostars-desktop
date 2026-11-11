# ADR-0001 — Desktop framework and language boundaries

Date: 2026-11-10
Status: **PROPOSED / pending proof-of-concept approval**
Owner: VirgoStars project
Scope: Windows first, macOS later; online account + genuine offline use.

## Decision
Build a **Tauri 2** desktop shell, an **Angular + TypeScript** UI with **Three.js** graphics, and a **Rust native desktop core**; use SQLite as the local transactional store (encryption implementation to be proven). Share the **same Rust astronomical implementation** from VirgoStars-Ephemeris without duplicating astronomy in TypeScript.

This is deliberately multi-language, not a recommendation to write the whole application in one language:

| Language / technology | Responsibility | Why |
| --- | --- | --- |
| TypeScript (strict) | UI/application view models, calls to astrological-functions, renderer bridge | Matches existing Angular/TypeScript VirgoStars ecosystem |
| Angular | Desktop UI, navigation, panels, accessibility, state | Reuse current Angular expertise and graphics library architecture |
| Three.js / WebGL | Natal/transit/synastry charts | Reuse astrological-charts, not another renderer |
| Rust | Tauri shell, OS API, local persistence, secure sync transport/worker, native ephemeris | Efficient, memory-safe language with existing VirgoStars-Ephemeris core |
| SQLite | Local chart/user cache, durable outbox, revision metadata | Embedded transactional DB, no local PostgreSQL server |
| HTTPS + JSON/versioned schemas | VirgoStars backend integration | Explicit server-owned identity, ownership, sync API contract |

The TypeScript functions library may use the existing Rust WASM bridge if that is the upstream supported entry point. A *native Rust bridge or Rust direct invocation* may be preferable on desktop, but must not change numerical semantics. **Pick one canonical Rust engine**, provide shared fixtures and compare outputs across adapters; do not maintain divergent astronomical algorithms.

## Alternatives considered
| Option | Upside | Why not the default |
| --- | --- | --- |
| Electron + Angular/Node | Mature ecosystem, simpler Node reuse, consistent Chromium engine | Higher typical memory/bundle overhead; parallel native Rust integration still needed; may be an escape hatch if Tauri WebView/Three.js fails |
| .NET + Avalonia | Cross-platform native-feeling UI, strong Windows tooling | Would introduce C# UI rewrite and a new chart renderer/bridge |
| Python + PySide/PyQt | Easy for Python contributors and scripting | Rewriting Angular/Three.js or embedding a browser introduces extra complexity, packaging and license review |
| Pure Rust desktop UI (egui/iced) | One primary language, native execution | Would discard reusable Angular/Three.js work and require a new complex chart renderer |
| PWA only | Simple deployment | Does not meet native updates, private local persistence, OS integration and offline-first requirements as reliably |

## Acceptance spike / falsification criteria
Before declaring the choice final, create a *synthetic* Tauri + Angular spike:
1. Windows 11 installable build on the supported architecture(s), cold start and offline start.
2. Render a real Three.js chart from astrological-charts with permitted synthetic assets, exercise zoom/export, test WebView2 GPU behavior and recovery from context loss.
3. Call a deterministic Rust calculation/fixture over a typed bridge, verify equality with the upstream reference.
4. Read/write a SQLite database, forcibly stop the app mid-transaction, reopen safely and preserve the pending outbox.
5. Test Windows secure credential storage and a locked-offline scenario without putting secrets in frontend storage.
6. Verify that a *signed* dummy update can be validated in a disposable test environment and that invalid signatures are rejected.
7. Document how the same code will compile on macOS with WKWebView; no promise of a signed Mac release until native testing and notarization.

If a blocking WebView/Three.js or native dependency issue remains, revisit **Electron** with measured benchmark evidence, not just preference.

## Version and platform policy
- Select and lock tested exact/compatible package versions in the first implementation PR; do not assume current documentation version equals verified compatibility.
- Initial support target: Windows 11 x64; evaluate Windows 10 and Windows ARM64 explicitly. macOS both Apple Silicon/Intel evaluated, release later.
- Tauri uses WebView2 on Windows and WKWebView on macOS. Cross-platform UI testing is required; identical pixels are not guaranteed.
- Builds for each OS need that OS's toolchain/signing process unless cross-build is explicitly validated.
- Runtime application data and binaries version independently; the updater does not implicitly migrate user data.

## References
- https://v2.tauri.app/start/
- https://v2.tauri.app/concept/architecture/
- https://v2.tauri.app/start/prerequisites/
- https://v2.tauri.app/plugin/updater/
- https://github.com/Cesare-ml/VirgoStars-Ephemeris
- https://github.com/Cesare-ml/astrological-charts
