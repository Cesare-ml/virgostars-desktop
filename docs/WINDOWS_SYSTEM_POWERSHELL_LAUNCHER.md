# Windows CMD launcher: system PowerShell only

**Status:** Narrow security hardening for an experimental Windows 11 x64 source build. Not a Windows runtime test, release, installer, or astronomy validation.

## Context

The Windows MVP integration branch (#112) already consolidated the two build workflows: `scripts/build-windows.cmd` is now just a wrapper which delegates to the single reviewed `scripts/build-windows-spike.ps1`. The PowerShell bootstrap handles locked npm/Cargo dependency checks, native IPC inventory, Angular offline assets, local CSS, the one-time Tauri packaging stage and PE32+ header verification.

Before this patch, the CMD wrapper called the unqualified `powershell.exe` found on the process search path. On Windows, executable lookup can be influenced by the current directory and `PATH`, potentially causing an unexpected `powershell.exe` to run instead of the Windows-supplied host.

## Change

The CMD wrapper now resolves a fixed OS path and always quotes it:

```bat
set "VS_SYSTEM_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%VS_SYSTEM_POWERSHELL%" (
    echo BUILD STOPPED: Windows PowerShell is required for this prototype. 1>&2
    exit /b 1
)
"%VS_SYSTEM_POWERSHELL%" -NoProfile -NonInteractive -File "%~dp0build-windows-spike.ps1"
set "VS_BUILD_EXIT=%ERRORLEVEL%"
exit /b %VS_BUILD_EXIT%
```

If Windows PowerShell is absent or blocked, the launcher fails rather than attempting a PATH-based or PowerShell Core fallback. It does not change execution policy, download a shell, invoke multiple build pipelines, hide an exit status, or run privileged actions independently. The normal `cmd` file remains an optional entry point; direct review and manual invocation of the PowerShell bootstrap remain possible.

## Tests actually executed

`tests/windows-cmd-system-powershell.test.mjs` adds seven Node tests of the actual launcher/PowerShell source contract: exact quoted system executable, guarded existence, subprocess exit status, rejection of PATH fallback/unquoted calls, detection of removed error handling, and preserved locked build/IPC/CSS/PE gate sequence.

**Executed locally with Node.js 22.16.0, on a partial mirror with exact verified Git blobs:**

```sh
node --test tests/windows-cmd-system-powershell.test.mjs
node --check tests/windows-cmd-system-powershell.test.mjs
```

- **7/7 Node tests PASS**, zero failures or skips.
- Git blob SHA-1 confirmed against the actual branch contents:
  - `scripts/build-windows.cmd` `fac34f892bac987ba984a303e9d05c3f452c619e`
  - `scripts/build-windows-spike.ps1` `b0bb3e6f98c5fddcff21f4fc9d900d8f3bffc70f`
  - `tests/windows-cmd-system-powershell.test.mjs` `9523bc24f4de7e8be2c1c14f755410efe181e513`
- Eleven independent source-level assertions also passed against directly fetched GitHub file contents, including command ordering and negative mutations.

A complete `npm test` from the full repository, real CMD execution on Windows, Angular build, Cargo/Tauri and offline WebView2 testing were **not performed** by this patch. Node tests checking launcher text cannot confirm Windows process-launch semantics; a Windows smoke remains mandatory.

## Integration

This change intentionally preserves the newer **single PowerShell bootstrap** design of draft #112. A previously explored alternative branch (`fix/windows-cmd-gate-parity-20261113`) independently duplicated the same ten build gates in CMD and is **superseded; do not merge or publish it**. The consolidated delegate is less error-prone and remains the source of truth.

This patch does not change production, any account/birth/latitude data, local cities/rights, Rust commands, npm or Cargo dependencies, private artwork, the CPAL license/attribution, GitHub Actions, repository visibility, release endpoints or `main`.
