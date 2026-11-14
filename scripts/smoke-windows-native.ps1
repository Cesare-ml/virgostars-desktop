# Manual Windows 11 x64 smoke of the already compiled local Tauri prototype.
# No dependency installation, downloads, source edits, screenshots or log files.
# This is not an installer, release/signature verification or automated visual QA.
param(
    [switch] $Interactive,
    [ValidateRange(2, 30)] [int] $WindowWaitSeconds = 15
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    throw 'NATIVE_SMOKE_WINDOWS_ONLY'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'NATIVE_SMOKE_NODE_REQUIRED'
}

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
# Exact Cargo binary name; the user cannot supply an arbitrary executable path.
$exe = Join-Path $root 'src-tauri\target\release\virgostars-desktop-spike.exe'

function Invoke-ReadOnlyGate {
    param([string] $Label, [string] $Path)
    & node $Path
    if ($LASTEXITCODE -ne 0) {
        throw ('NATIVE_SMOKE_PREFLIGHT_FAILED_' + $Label)
    }
}

Push-Location $root
try {
    # A structural Windows PE check does not prove signing or safe execution.
    # Verify source configuration and the exact built browser artifacts first.
    Invoke-ReadOnlyGate 'VERSION' 'scripts/verify-desktop-version.mjs'
    Invoke-ReadOnlyGate 'TAURI_SECURITY' 'scripts/verify-tauri-security-config.mjs'
    Invoke-ReadOnlyGate 'BUNDLED_CSS' 'scripts/verify-bundled-css.mjs'
    Invoke-ReadOnlyGate 'COMPONENT_STYLES' 'scripts/verify-component-styles.mjs'
    Invoke-ReadOnlyGate 'WINDOWS_PE' 'scripts/verify-windows-pe.mjs'
}
finally {
    Pop-Location
}

try {
    $appProcess = Start-Process -FilePath $exe -WorkingDirectory $root -PassThru -ErrorAction Stop
}
catch {
    # Never print the OS exception, user directory or process arguments.
    throw 'NATIVE_SMOKE_LAUNCH_FAILED'
}

$clock = [System.Diagnostics.Stopwatch]::StartNew()
$foundWindow = $false
while ($clock.Elapsed.TotalSeconds -lt $WindowWaitSeconds) {
    Start-Sleep -Milliseconds 250
    try {
        $appProcess.Refresh()
        if ($appProcess.HasExited) {
            throw 'NATIVE_SMOKE_EARLY_EXIT'
        }
        if ($appProcess.MainWindowHandle -ne [IntPtr]::Zero) {
            $foundWindow = $true
            break
        }
    }
    catch {
        throw 'NATIVE_SMOKE_PROCESS_UNAVAILABLE'
    }
}

if (-not $foundWindow) {
    throw 'NATIVE_SMOKE_NO_MAIN_WINDOW'
}

Write-Host 'NATIVE_SMOKE_WINDOW_DETECTED: local Windows GUI process has a main window.'
Write-Host 'NOT YET VERIFIED: visible UI, applied CSS, WebGL/chart behavior, offline mode, Authenticode or native signing.'
Write-Host 'The test leaves the experimental app running for visual inspection.'

if (-not $Interactive) {
    Write-Host 'For a manual visual checklist, rerun with -Interactive.'
    exit 0
}

# Intentionally no automation of keyboard/mouse, screen capture or filesystem
# export: each visual observation must come from the maintainer.
$checks = @(
    @{ Key = 'styles'; Prompt = 'Sidebar, central chart and inspector visibly use the intended CSS grid?' },
    @{ Key = 'chart'; Prompt = 'Synthetic chart appears centered at normal size without WebGL errors?' },
    @{ Key = 'themes'; Prompt = 'Light and dark themes both render correctly?' },
    @{ Key = 'modes'; Prompt = 'Four synthetic chart modes and zoom/fit controls work?' },
    @{ Key = 'export'; Prompt = 'Synthetic PNG export completes without unexpected navigation?' },
    @{ Key = 'places'; Prompt = 'Offline city search reports the bundled catalog state truthfully?' },
    @{ Key = 'offline'; Prompt = 'With Internet disconnected and dev server stopped, the app still works?' }
)

$failures = @()
foreach ($check in $checks) {
    $reply = Read-Host ($check.Prompt + ' [y/N]')
    if ($reply -notin @('y', 'yes', 's', 'si', 'sì')) {
        $failures += $check.Key
    }
}

if ($failures.Count -gt 0) {
    Write-Host ('NATIVE_SMOKE_MANUAL_FAILED: ' + ($failures -join ', '))
    exit 1
}
Write-Host 'NATIVE_SMOKE_MANUAL_PASSED: all seven visual observations confirmed by maintainer.'
Write-Host 'This does not validate installer signing, astronomical precision, cloud accounts or publication readiness.'
exit 0
