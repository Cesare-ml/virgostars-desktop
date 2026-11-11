# Release, automatic updates and platform packaging

Status: **PROPOSAL**. There is no published installer, version, update endpoint or signer.

## Target
- First public installers: Windows, with Windows 11 x64 as the initial test target.
- Later: macOS (Apple Silicon + Intel after native build and tests); consider Windows 10/ARM64 separately.
- Two channels may be introduced: stable and beta. No automatic roll-forward from stable to beta.
- Automatic **check/download** permitted when online; apply on safe app restart after pending local edits have been durably saved, never abruptly during writing.

## Tauri 2 updater
- Updates **must** be signed using Tauri's mandatory update-signing mechanism, regardless of the transport/server.
- Installer/code signing on Windows and macOS is a distinct platform trust process; plan Windows signing and Apple Developer ID signing/notarization before claiming warning-free installation.
- Public key in client, private release key held securely outside repository and CI. Never put secret into GitHub issue, PR or sample.
- Release manifest specifies version, platform/architecture, size/hash where supported, signature and compatible data schema.
- Rollback app code and local schema are separate problems: take a safe migration snapshot and support explicit recovery; never casually downgrade an incompatible DB.

## Process (manual at first; no GitHub Actions)
1. Tag a reproducible pinned dependency revision from a reviewed PR and passed test matrix.
2. Run manual Windows build and smoke tests on a clean Windows VM (including WebView2 availability).
3. Test update staging against a throwaway profile, interrupted download, invalid signature and crash on restart.
4. Sign artifacts offline/controlled environment; publish immutable binaries, manifests and release notes. GitHub Releases or a dedicated HTTPS origin are candidate distribution channels.
5. Observe adoption/errors without collecting private natal or contact data.
6. For macOS, build/test on a Mac, sign/notarize and verify native startup/update behavior before release.

## Data and content updates
App binaries, astronomical kernels and compressed event datasets should have **independent versions**. Kernel and event files must be provenance-checked, downloaded on demand or shipped only if distribution permissions allow, integrity-checked and kept available offline after a successful download. Do not silently swap to a less precise astronomy backend.

## Required release gates
Correct login/logout, offline startup, full sync round trip, conflict test, deterministic astrology fixtures, validated rendering with approved assets, database migrations/recovery, installer reputation, signatures, accessibility and Windows memory/WebGL test.
