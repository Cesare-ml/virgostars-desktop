# Windows Git tracked-path preflight

**Status: locally tested as a read-only Node.js/Git developer gate.** It is not a Windows GUI, installer, or distribution acceptance test.

Git can store filenames on Linux/macOS that cannot be checked out safely on a Windows workstation. The existing `verify-build-privacy.mjs` examines only the **built Angular browser bundle**. This separate preflight inspects **all filenames currently tracked in the local Git index**, so invalid names can be detected before a Windows build attempt.

## Automatic Windows bootstrap integration

The single reviewed `scripts/build-windows-spike.ps1` entrypoint now invokes
`node scripts/verify-windows-tracked-paths.mjs` at the start of the Desktop
setup stage, **before** `desktop-doctor`, any `npm ci`, any Angular or Rust
build and Tauri packaging. `scripts/build-windows.cmd` continues to delegate
to the same PowerShell entrypoint. A nonzero check exit code stops the bootstrap.

The check reports the **current locally tracked Git index**; it cannot protect
a checkout that Windows already refused to create. For cross-platform review,
run it in an existing Linux/macOS working tree or inspect the Git tree before
attempting to check out an unsafe branch on Windows.

Parallel draft PR #235 also edits the Windows bootstrap. Reviewers must
reconcile both changes before accepting either; neither PR has been merged
by this update.

## Manual use (from the Desktop repository root)

```sh
node scripts/verify-windows-tracked-paths.mjs
node --test tests/windows-tracked-paths.test.mjs
```

The test file is also discovered by the existing `npm test` glob. No new npm dependency or GitHub Actions workflow is required.

The utility runs only `git rev-parse --show-toplevel` and `git ls-files --cached -z --full-name --`. It requires the current directory inferred from the script to match the Git repository root and rejects absent Git or incomplete output. Its only output is an aggregate number of checked tracked files or a constant error reason; it does not log file paths.

It rejects reserved Win32 device names (including `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`, `CONIN$`, `CONOUT$` and known superscript-digit aliases), trailing dots/spaces, forbidden characters, too-long path segments, invalid UTF-8, empty entries, Windows case/NFC-name aliases, and file-vs-directory names that collide under the same conservative normalization. Input is bounded to 4 MiB / 20,000 tracked paths. The Git listing is NUL-delimited and decoded with fatal UTF-8.

## Scope and limitations

- The check is **read-only**. It performs no fetch, checkout, merge, file writes, package install, deployment or release.
- `git ls-files --cached` covers Git-tracked names in the index, not untracked files, uncommitted content, submodule contents, downloaded dependencies, or generated build assets. Symlink targets, actual file permissions, malware, secrets, licenses, WebView2 runtime behavior and executable signatures are **not** examined.
- NFC plus lowercase is a conservative **Windows alias heuristic**, not a complete model of every NTFS or Win32 filesystem name comparison. Passing is not certification of full Windows portability.
- Use it **in addition to**, not in place of, `npm test`, `npm run verify:privacy`, bundle/CSS checks and real Windows WebView2 visual smoke.
- Current Linux synthetic verification (Node.js 22.16.0, Git 2.47.3): **24/24 Node test cases passed**, including temporary Git fixture checks that HEAD, index and working tree are unchanged. No full Desktop suite, Angular/Tauri compile or native Windows run was performed during this change.

The new bootstrap-order and CMD-delegation tests also passed on Linux with
`node --test tests/windows-tracked-paths.test.mjs` (24/24). The committed Git
blobs of the source, tests, PowerShell bootstrap and CMD entrypoint exactly
matched the four files used in this local Node/Git test run. No native Windows
PowerShell invocation or full `npm test` / Tauri/WebView2 build was performed;
these remain acceptance gates before integration or release.
