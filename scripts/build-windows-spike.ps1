# Read-only diagnostics followed by a Windows x64 prototype build.
# Never auto-deletes files, accesses VirgoStars accounts or deploys anything.
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    throw 'This build script targets Windows. For source-only checks, run node scripts/desktop-doctor.mjs.'
}
$desktop = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$charts = Join-Path (Split-Path $desktop -Parent) 'astrological-charts'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 22 or 24 is required. Install the supported Node LTS release.'
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'npm.cmd was not found. Reinstall Node.js/npm; do not change PowerShell execution policy.'
}

function Invoke-Step {
    param([string] $Description, [string] $Command, [string[]] $Arguments)
    Write-Host "STEP: $Description"
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed (exit $LASTEXITCODE). See docs/WINDOWS_BUILD_GATE.md; no changes were deployed."
    }
}

Push-Location $desktop
try {
    Invoke-Step 'Read-only Windows setup preflight' 'node' @('scripts/desktop-doctor.mjs', '--stage=setup', '--strict')
}
finally { Pop-Location }

Push-Location $charts
try {
    Invoke-Step 'Install Charts dependencies using existing reviewed lockfile' 'npm.cmd' @('ci')
    Invoke-Step 'Build upstream graphics library (not its demo)' 'npm.cmd' @('run', 'build:library')
    if (-not (Test-Path '.local/demo-pack/manifests/approved-assets.json')) {
        Invoke-Step 'Generate strictly synthetic development graphics' 'npm.cmd' @('run', 'demo:pack')
    }
}
finally { Pop-Location }

Push-Location $desktop
try {
    # package-lock.json is committed. npm ci fails rather than rewriting it or resolving new versions.
    Invoke-Step 'Install pinned Desktop dependencies from the committed lockfile' 'npm.cmd' @('ci')
    Invoke-Step 'Run all available Node test files' 'npm.cmd' @('test')
    Invoke-Step 'Audit native IPC commands and Tauri capabilities' 'npm.cmd' @('run', 'verify:ipc')
    Invoke-Step 'Check compiled library and synthetic pack prerequisites' 'npm.cmd' @('run', 'doctor:build')
    Invoke-Step 'Build Angular and validate the offline assets' 'npm.cmd' @('run', 'build:ui')
    Invoke-Step 'Check standalone local CSS before Tauri packaging' 'npm.cmd' @('run', 'verify:css')
    Invoke-Step 'Generate temporary development icon' 'npm.cmd' @('run', 'prepare:icon')
    Push-Location (Join-Path $desktop 'src-tauri')
    try { Invoke-Step 'Run Rust unit tests with the committed lockfile' 'cargo' @('test', '--locked') }
    finally { Pop-Location }
    # The tauri:build npm script rebuilds Angular, invalidating the CSS/bundle checks above.
    # Call the already-installed Tauri CLI directly in offline npm mode, so the
    # native binary packages the exact previously audited frontendDist.
    Invoke-Step 'Compile previously verified Angular/Tauri prototype' 'npm.cmd' @('exec', '--offline', '--', 'tauri', 'build')
    Invoke-Step 'Verify generated Angular files and prototype executable exist' 'npm.cmd' @('run', 'doctor:verify')
    Invoke-Step 'Verify Windows x64 PE header' 'node' @('scripts/verify-windows-pe.mjs')
    Write-Host 'Prototype build finished. No installer, signing, deployment or merge performed.'
    Write-Host 'Next: disconnect Internet and test WebView2, all chart modes, PNG export and native IPC.'
}
finally { Pop-Location }
