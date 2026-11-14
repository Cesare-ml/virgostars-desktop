# Windows build gate — read-only diagnostics and native acceptance

**Status (2026-11-10):** Node.js doctor code and fixture tests validated; Windows Angular/Tauri build **not yet verified**.

This guide is for contributors who want to run VirgoStars Desktop without needing to understand the full architecture. No real VirgoStars account, production data, artwork or AWS credential is required.

## 1. Prerequisites

Use Windows 11 x64 and install Node.js 22 LTS or 24, npm, **Rust stable MSVC 1.90.0 or newer**, Microsoft C++ Build Tools with the Desktop development with C++ workload, and WebView2. Clone authorized `astrological-charts` and `virgostars-desktop` repositories into sibling folders.

Official references: [Tauri Windows prerequisites](https://tauri.app/start/prerequisites/) and [Angular 20 compatibility](https://angular.dev/reference/versions).

### Rust 1.90 minimum — Windows troubleshooting

The first native build attempt reported `rustc 1.89.0`, but Tauri 2.12.x and `muda` from its resolved dependency graph require at least **rustc 1.90.0**. The desktop Cargo manifest now declares `rust-version = "1.90"`, and the doctor checks the actual compiler version before running Cargo tests.

From PowerShell run:

```powershell
rustup update stable
rustup default stable
rustc --version
rustup show active-toolchain
```

`rustc --version` must be **1.90.0 or newer**. If `rustup show active-toolchain` reports an overridden 1.89 toolchain in this folder, check `rustup override list` and your project's `rust-toolchain.toml` before deciding whether to change the override. You can run `cargo +stable test` to test with installed stable independently. Do not delete `Cargo.lock` or run uncontrolled `cargo update` as a workaround for a compiler mismatch.

## 2. Diagnose without installing or changing anything

From the desktop folder, run:

```powershell
node scripts/desktop-doctor.mjs
node scripts/desktop-doctor.mjs --stage=setup --json
```

The diagnostic checks Node/npm versions, Rust/Cargo and the Windows MSVC host, C++ tools, WebView2 registry presence, sibling package contract, Angular output path, lockfiles and generated build prerequisites. It reports `[OK]`, `[WARN]`, and `[BLOCK]`. A WebView2 registry warning is not proof of absence. It does not read user files or contact the network; the JSON report includes no local absolute paths or account details.

After dependencies are installed, use `node scripts/desktop-doctor.mjs --stage=build --strict`. After building, use `node scripts/desktop-doctor.mjs --stage=verify --strict`. Only `--strict` turns blocked findings into an exit error.

## 3. One-command Windows build attempt

From `virgostars-desktop`:

```powershell
powershell -NoProfile -File .\scripts\build-windows-spike.ps1
```

Or, from Command Prompt, invoke `scripts\build-windows.cmd`. The `.cmd` launcher now delegates to **the same** PowerShell bootstrap, returns its exit code, and never maintains a second independent installation or Tauri build path. It does not modify execution policy, install PowerShell or download anything by itself.
The CMD wrapper resolves the quoted Windows-supplied `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` directly rather than trusting `PATH`, and fails if that executable is missing.

The runner uses `npm.cmd` on Windows to avoid the `npm.ps1` execution-policy issue. It first runs the read-only doctor, **audits the committed Desktop npm lockfile before invoking any package installer**, then uses the Charts repository's committed lockfile, builds only the upstream **library**, generates an original synthetic development asset pack if missing, installs desktop development dependencies **using the reviewed npm lockfile (`npm ci`)**, runs Node tests, audits the reviewed native IPC command registry and Tauri capabilities, builds Angular with exact asset verification, checks that the bundled stylesheet exists, runs Rust unit tests with `cargo test --locked`, compiles Tauri **from that same already-audited Angular output** and checks expected output files. It stops at the first failed command.

The bootstrap invokes the locally installed Tauri CLI using `npm.cmd exec --offline -- tauri build` rather than `npm.cmd run tauri:build`: the general-purpose npm script rebuilds Angular and would invalidate the independent CSS check. The current `tauri.conf.json` has no `beforeBuildCommand`; adding one requires reviewing this gate again. The separate `npm run tauri:build` command remains available for ordinary standalone builds.

It does not change PowerShell execution policy, delete generated folders automatically, access production, deploy software, or merge a PR. A successful build is not proof of scientific/visual accuracy.

## 4. Manual checkpoints (when investigating a failure)

In `astrological-charts`:

```powershell
npm.cmd ci
npm.cmd run build:library
npm.cmd run demo:pack
```

Only run `demo:pack` once, when `.local/demo-pack` is absent.

In `virgostars-desktop`:

```powershell
node scripts/verify-npm-lock.mjs
npm.cmd ci
npm.cmd test
npm.cmd run verify:ipc
npm.cmd run doctor:build
npm.cmd run build:ui
npm.cmd run verify:css
npm.cmd run verify:bundle
npm.cmd run prepare:icon
cd src-tauri
cargo test --locked
cd ..
npm.cmd exec --offline -- tauri build
npm.cmd run doctor:verify
```

`package-lock.json` and `src-tauri/Cargo.lock` are **already committed and reviewed**. The offline, dependency-free `node scripts/verify-npm-lock.mjs` preflight checks the Desktop root manifest against npm lockfile v3, allows only the specific public sibling Charts symlink and SHA-512-pinned tarballs from `https://registry.npmjs.org/`. It rejects additional local links, other registries, missing integrity metadata and unapproved URLs before `npm ci`; it does **not** validate the sibling Charts repository's own lockfile. The npm registry allowlist does **not** prove package safety, authenticity beyond published hashes, vulnerability-free dependencies or harmless installation scripts. `npm ci` fails when the manifest and npm lockfile disagree, rather than updating the lockfile; `cargo test --locked` similarly rejects Rust lockfile drift. Review any deliberate dependency or lockfile updates in a separate PR; **never handwrite lockfiles**. The Tauri prototype still has `bundle.active=false`: no user installer or signed updater is produced.

To use `npm.cmd run tauri:dev`, launch `npm.cmd start` in another terminal first. The development server is not needed by the intended packaged offline executable.

## 5. Acceptance gate still pending

- [ ] Build Angular against the actual authorized Charts library and synthetic pack.
- [ ] Run Rust unit tests, compile a Windows x64 Tauri binary and verify the required prerequisites.
- [ ] Disconnect Internet and stop the dev server; launch the packaged test binary.
- [ ] Test the four chart modes, both themes, resize/fit, WebGL recovery and PNG export in WebView2.
- [ ] Verify browser-preview versus native-demo runtime state.
- [ ] Confirm no unexpected network requests, and test keyboard and contrast at 1280×720, 1366×768, 1600×900 and 1920×1080 with DPI scaling.
- [ ] Review generated npm/Cargo locks, dependencies, licenses and asset rights before any public build.

**Limitations:** `verify:ipc` is a conservative native IPC/capability **source audit**, and `verify:css` checks the produced local CSS files; neither check proves that WebView2 has loaded the stylesheet or that compiled native capabilities are safe. The doctor checks local prerequisites and existence/consistency of output, not end-to-end rendering, native signing, astronomy accuracy or network isolation. The authoring environment lacks Rust and npm registry access; the Windows acceptance gate cannot be declared passed. The current executable name derives from the experimental Cargo package name `virgostars-desktop-spike`.

Do not report a release, perform GitHub Actions, merge on main, expose original artwork or change the repository license/visibility without a separate maintainer decision.

## Windows x64 toolchain diagnostics (2026-11-13)

The read-only doctor now requires the `rustc -vV` **host** triple to be exactly
`x86_64-pc-windows-msvc` for the supported Windows 11 x64 prototype.
An otherwise current Rust compiler targeting ARM64, i686 or Windows GNU is
**blocked**, not reported as ready for the default Windows x64 build. This is
a host preflight only; it does not verify all installed Rust targets or the
architecture of a final binary. The check intentionally remains non-blocking
for non-Windows hosts pending macOS/other-platform acceptance work.

The Node gate accepts stable exact `process.version` values only; strings
with release-candidate, nightly, build-metadata or garbage suffixes do not pass.
These checks make the preflight more conservative, not a substitute for
`npm test`, `cargo test`, a Windows binary build and an offline WebView2 smoke.
No production services, user data, signing keys or releases are involved.


## Canonical SHA-512 lockfile integrity (2026-11-13)

Before `npm ci`, the local, dependency-free preflight additionally requires every
registry tarball's `integrity` value to be **one** canonical
`sha512-<Base64>` digest encoding exactly **64 bytes**. It rejects truncated,
overlong, unpadded, invalidly padded and non-canonical Base64 values (including
non-zero unused padding bits), even when their text begins with `sha512-`.
The existing fixed registry origin and sibling Charts link restrictions remain
unchanged.

Run `node --test tests/npm-lock-provenance.test.mjs` and
`node scripts/verify-npm-lock.mjs` against the committed manifest/lock before
installing dependencies. This is a lockfile **shape/provenance** preflight,
not a comparison against a downloaded tarball, a signature verification,
a vulnerability audit or proof that install scripts are harmless.
No network requests or package installs are performed by the preflight.


## Registry tarball identity gate (2026-11-13)

The pre-`npm ci` lock audit additionally matches the exact installed registry
package **name and pinned version** to the `resolved` tarball path. For example,
`node_modules/three` at `0.170.0` must resolve to
`https://registry.npmjs.org/three/-/three-0.170.0.tgz`. Merely pointing
to any `.tgz` on the official npm registry is no longer sufficient.

Scoped names (`@angular/core`) and nested `node_modules` installations are
supported. Legitimate `npm:` aliases are permitted **only when** a dependency
entry in a **different** pinned lockfile package explicitly declares that
installed alias and source name, and the URL names the underlying source package. Three existing
`@isaacs/cliui` compatibility aliases remain accepted without a blanket
exception for arbitrary renamed packages.

To inspect this gate independently:

```powershell
node --test tests/npm-tarball-identity.test.mjs tests/npm-lock-provenance.test.mjs
node scripts/verify-npm-lock.mjs
```

This is intentionally restrictive for the current pinned npm registry layout.
Future alternate registry URL layouts or alias conventions require a reviewed
source change rather than a silent preflight bypass. The audit is local,
read-only and does not fetch tarballs: it verifies only lockfile metadata,
not actual downloaded bytes, publishers, lifecycle scripts, transitive code
safety, or dependency vulnerabilities. npm remains responsible for validating
tarball contents against the pinned integrity digests during installation.
