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
# Resolve an actual Node executable once. Do not run a PowerShell alias,
# function or script named 'node' between the preflight checks.
$nodeCommand = Get-Command -Name 'node.exe' -CommandType Application -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand -or [string]::IsNullOrWhiteSpace($nodeCommand.Source) -or
    -not [System.IO.Path]::IsPathRooted($nodeCommand.Source)) {
    throw 'NATIVE_SMOKE_NODE_REQUIRED'
}
$nodeExe = $nodeCommand.Source

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
# Exact Cargo binary name; the user cannot supply an arbitrary executable path.
$exe = Join-Path $root 'src-tauri\target\release\virgostars-desktop-spike.exe'

function Invoke-ReadOnlyGate {
    param([string] $Label, [string] $Path)
    # Gate output and PowerShell invocation errors may contain checkout paths.
    # Hide both and always report only the fixed gate label, including when
    # Node cannot start or stderr redirection fails under Windows PowerShell.
    try {
        & $nodeExe $Path *> $null
    }
    catch {
        throw ('NATIVE_SMOKE_PREFLIGHT_FAILED_' + $Label)
    }
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
    Invoke-ReadOnlyGate 'NATIVE_IPC' 'scripts/verify-native-ipc.mjs'
    # Validate the full synthetic offline package, not only a linked CSS file.
    Invoke-ReadOnlyGate 'OFFLINE_BUNDLE' 'scripts/verify-offline-bundle.mjs'
    Invoke-ReadOnlyGate 'BUNDLED_CSS' 'scripts/verify-bundled-css.mjs'
    Invoke-ReadOnlyGate 'COMPONENT_STYLES' 'scripts/verify-component-styles.mjs'
    Invoke-ReadOnlyGate 'WINDOWS_PE' 'scripts/verify-windows-pe.mjs'
    # Prevent trusting a GUI binary older than its current Angular output.
    Invoke-ReadOnlyGate 'BUNDLE_FRESHNESS' 'scripts/verify-native-bundle-freshness.mjs'
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
$windowFailure = 'NATIVE_SMOKE_NO_MAIN_WINDOW'
while ($clock.Elapsed.TotalSeconds -lt $WindowWaitSeconds) {
    try {
        Start-Sleep -Milliseconds 250
        $appProcess.Refresh()
        if ($appProcess.HasExited) {
            $windowFailure = 'NATIVE_SMOKE_EARLY_EXIT'
            break
        }
        if ($appProcess.MainWindowHandle -ne [IntPtr]::Zero) {
            $foundWindow = $true
            break
        }
    }
    catch {
        # Never expose an OS exception that could contain a private path.
        $windowFailure = 'NATIVE_SMOKE_PROCESS_UNAVAILABLE'
        break
    }
}

# A transient window handle is not enough: a process can crash immediately
# after the first successful observation. Recheck once after a short dwell.
if ($foundWindow) {
    try {
        Start-Sleep -Milliseconds 250
        $appProcess.Refresh()
        if ($appProcess.HasExited) {
            $foundWindow = $false
            $windowFailure = 'NATIVE_SMOKE_EARLY_EXIT'
        }
        elseif ($appProcess.MainWindowHandle -eq [IntPtr]::Zero) {
            $foundWindow = $false
            $windowFailure = 'NATIVE_SMOKE_WINDOW_DISAPPEARED'
        }
    }
    catch {
        $foundWindow = $false
        $windowFailure = 'NATIVE_SMOKE_PROCESS_UNAVAILABLE'
    }
}

if (-not $foundWindow) {
    # Cleanup only the process returned by THIS Start-Process call, not other
    # VirgoStars instances or arbitrary PIDs. Successful runs remain open.
    try {
        $appProcess.Refresh()
        if (-not $appProcess.HasExited) {
            $appProcess.Kill()
            [void]$appProcess.WaitForExit(2000)
        }
    }
    catch {
        # Best-effort cleanup; preserve the stable startup failure label.
    }
    throw $windowFailure
}

Write-Host 'NATIVE_SMOKE_WINDOW_DETECTED: local Windows GUI process has a main window.'
Write-Host 'NOT YET VERIFIED: visible UI, applied CSS, WebGL/chart behavior, offline mode, Authenticode or native signing.'
Write-Host 'The test leaves the experimental app running for visual inspection.'

if (-not $Interactive) {
    Write-Host 'For a manual visual checklist, rerun with -Interactive.'
    exit 0
}

# The initial main-window observation does not establish that the GUI
# remains available while the maintainer works through the manual checklist.
# Only inspect the handle returned by this smoke run; never search by name/PID.
function Test-SmokeMainWindowAlive {
    param([System.Diagnostics.Process] $Process)
    try {
        $Process.Refresh()
        return (-not $Process.HasExited -and $Process.MainWindowHandle -ne [IntPtr]::Zero)
    }
    catch {
        # Do not expose process-inspection OS exceptions or local paths.
        return $false
    }
}

# Intentionally no automation of keyboard/mouse, screen capture or filesystem
# export: each visual observation must come from the maintainer.
$checks = @(
    @{ Key = 'styles'; Prompt = 'Sidebar, central chart and inspector visibly use the intended CSS grid?' },
    # Check the live WebView2 computed-style/geometry probe, not just packaged CSS.
    @{ Key = 'layout'; Prompt = ('Settings > Layout diagnostics / Diagnostica layout > Recheck styles / Ricontrolla stili reports Interface grid detected / Griglia dell{0}interfaccia rilevata?' -f [char]0x2019) },
    @{ Key = 'chart'; Prompt = 'Synthetic chart appears centered at normal size without WebGL errors?' },
    @{ Key = 'themes'; Prompt = 'Light and dark themes both render correctly?' },
    @{ Key = 'modes'; Prompt = 'Four synthetic chart modes and zoom/fit controls work?' },
    @{ Key = 'export'; Prompt = 'Synthetic PNG export completes without unexpected navigation?' },
    @{ Key = 'places'; Prompt = 'Offline city search reports the bundled catalog state truthfully?' },
    @{ Key = 'offline'; Prompt = 'With Internet disconnected and dev server stopped, the app still works?' }
)

$failures = @()
foreach ($check in $checks) {
    if (-not (Test-SmokeMainWindowAlive -Process $appProcess)) {
        Write-Host 'NATIVE_SMOKE_MANUAL_WINDOW_LOST'
        exit 1
    }
    try {
        $reply = Read-Host ($check.Prompt + ' [y/N]')
    }
    catch {
        # An unavailable input stream cannot count as an affirmed checkpoint.
        Write-Host 'NATIVE_SMOKE_MANUAL_INPUT_UNAVAILABLE'
        exit 1
    }
    if (-not (Test-SmokeMainWindowAlive -Process $appProcess)) {
        Write-Host 'NATIVE_SMOKE_MANUAL_WINDOW_LOST'
        exit 1
    }
    if ($reply -notin @('y', 'yes', 's', 'si', ('s' + [char]0x00EC))) {
        $failures += $check.Key
    }
}

if ($failures.Count -gt 0) {
    Write-Host ('NATIVE_SMOKE_MANUAL_FAILED: ' + ($failures -join ', '))
    exit 1
}
Write-Host 'NATIVE_SMOKE_MANUAL_PASSED: all eight visual observations confirmed by maintainer.'
Write-Host 'This does not validate installer signing, astronomical precision, cloud accounts or publication readiness.'
exit 0
