# Windows installer license notices

The Windows installer build collects the original project license and notice,
the local Leaflet, tz-lookup, Three.js and tslib licenses, Angular's generated third-party
notices, the original GSAP license banner, and license texts for the locked
Windows Cargo dependency graph. The generated files are included under
`licenses/` in the installer. Cargo metadata is resolved offline; an absent
license file fails the build unless an exact-version fallback is documented in
[`third-party/cargo-license-fallbacks`](../third-party/cargo-license-fallbacks/README.md).

Run `npm run build:installer` after staging the authorized resources. The
generator runs after the private frontend build and creates a local-only Tauri
overlay in `.local/release-licenses/`. It includes build-time Cargo packages
conservatively and does not write local paths into the notices. It is not an
independent legal review or proof that every transitive JavaScript dependency
is covered: review the output and the conditions of scientific data and other
non-code assets before release. A changed dependency may require a new
fallback and provenance review.

Local Windows verification on 2026-11-19 generated notices for 316 Cargo
packages and checked the installer archive and staged notice files. A negative
check confirmed that removing a required fallback stops generation. This is not
a clean-machine build or a completed legal review.

Signing and cryptographic verification are separate release requirements. Do
not treat generated notices, a successful installer build, or a test signature
as authorization to publish or install an unsigned update.

On 2026-11-19 the maintainer explicitly chose to publish Desktop 0.0.2 without
a certificate. This applies to that manual release; it does not enable the
automatic updater or authorize unsigned updates generally.
