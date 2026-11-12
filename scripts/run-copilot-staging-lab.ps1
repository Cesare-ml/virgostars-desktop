# Developer-only synthetic AI lab. Never run against production or real accounts.
# This runner builds/tests DEBUG+copilot-staging only and stops child processes on exit.
[CmdletBinding()]
param(
    [switch] $SyntheticOnly,
    [ValidateRange(1024, 65535)] [int] $BackendPort = 18883
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $SyntheticOnly) {
    throw 'Explicit -SyntheticOnly required. This is an unsigned, fictional token lab, NOT Virgo Stars authentication.'
}
if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    throw 'Native Tauri/WebView2 smoke is supported on Windows only.'
}

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tauri = Join-Path $root 'node_modules\.bin\tauri.cmd'
$angular = Join-Path $root 'node_modules\.bin\ng.cmd'
$backend = "http://127.0.0.1:$BackendPort"
$frontend = 'http://127.0.0.1:4200'
$fixture = $null
$frontendProcess = $null
# Do not inherit or erase existing developer sessions, which could hold real keys.
# The lab manages only fresh, fictional variables it creates itself.
$labEnvKeys = @(
    'VIRGOSTARS_COPILOT_FIXTURE_ACK',
    'VIRGOSTARS_COPILOT_PREVIEW_STAGING_ENABLED',
    'VIRGOSTARS_COPILOT_PREVIEW_STAGING_BACKEND_ORIGIN',
    'VIRGOSTARS_COPILOT_PREVIEW_STAGING_TEST_BEARER'
)
foreach ($key in $labEnvKeys) {
    if (Test-Path -Path ("Env:" + $key)) {
        throw 'Refusing to overwrite pre-existing AI staging environment variables. Open a clean throwaway terminal.'
    }
}

function Require-Binary {
    param([string] $Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing required tool: $Name. See docs/WINDOWS_BUILD_GATE.md."
    }
}
function Invoke-Checked {
    param([string] $Label, [string] $Binary, [string[]] $Arguments)
    Write-Host "CHECK: $Label"
    & $Binary @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Label failed (exit $LASTEXITCODE)." }
}
function Test-PortAvailable {
    param([int] $Port)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $pending = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(250)) { return $true }
        try { $client.EndConnect($pending); return $false } catch { return $true }
    } finally {
        $client.Close()
    }
}
function Wait-ForHttp {
    param([string] $Url, [int] $LimitSeconds = 45, [hashtable] $Headers = @{})
    $stopAt = (Get-Date).AddSeconds($LimitSeconds)
    do {
        try {
            $result = Invoke-RestMethod -Uri $Url -Headers $Headers -Method Get -TimeoutSec 2
            if ($null -ne $result) { return $result }
        } catch { # Never display exception content (may include a test bearer).
        }
        Start-Sleep -Milliseconds 350
    } while ((Get-Date) -lt $stopAt)
    throw 'Local synthetic lab endpoint did not become ready. No remote fallback attempted.'
}
function Stop-ChildTree {
    param([object] $Child)
    if ($null -eq $Child) { return }
    try {
        $Child.Refresh()
        if (-not $Child.HasExited) {
            & taskkill.exe /PID $Child.Id /T /F 2>$null | Out-Null
        }
    } catch { # Cleanup best-effort; never disclose credentials or process environment.
    }
}

Require-Binary 'node'
Require-Binary 'npm.cmd'
Require-Binary 'cargo'
Require-Binary 'rustc'
if (-not (Test-Path -LiteralPath $tauri) -or -not (Test-Path -LiteralPath $angular)) {
    throw 'Desktop npm dependencies are missing. Install them using docs/WINDOWS_BUILD_GATE.md.'
}
if (-not (Test-PortAvailable $BackendPort) -or -not (Test-PortAvailable 4200)) {
    throw 'Local fixture port or the required Angular dev port 4200 is occupied; refusing to use another service.'
}

Push-Location $root
try {
    # No secret exists during the complete dependency/build/test preflight.
    Invoke-Checked 'Windows environment doctor' 'node' @('scripts/desktop-doctor.mjs', '--stage=setup', '--strict')
    Invoke-Checked 'Real loopback fixture + TypeScript decoder tests' 'npm.cmd' @('run', 'test:ai:fixture')
    Invoke-Checked 'Prepare synthetic development icon' 'npm.cmd' @('run', 'prepare:icon')

    Push-Location (Join-Path $root 'src-tauri')
    try {
        Invoke-Checked 'Rust formatting' 'cargo' @('fmt', '--all', '--', '--check')
        Invoke-Checked 'Rust debug staging feature tests' 'cargo' @('test', '--features', 'copilot-staging')
        Invoke-Checked 'Rust release compilation (staging IPC absent)' 'cargo' @('check', '--release', '--features', 'copilot-staging')
    } finally { Pop-Location }

    # The Angular dev process must start BEFORE introducing even fictional bearer env vars.
    $frontendProcess = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'start') -WorkingDirectory $root -PassThru -NoNewWindow
    $null = Wait-ForHttp -Url $frontend

    # A throwaway unsigned JWT-shaped string is used for local equality checks only.
    # It is never a login token and is never put on a command line or in repository files.
    $testBearer = (& node -e "const c=require('node:crypto'); console.log(['eyJhbGciOiJub25lIn0','eyJzdWIiOiJzeW50aGV0aWMifQ',c.randomBytes(24).toString('base64url')].join('.'))").Trim()
    if ($LASTEXITCODE -ne 0 -or $testBearer.Length -lt 32) {
        throw 'Failed to generate a fictional test token.'
    }
    $env:VIRGOSTARS_COPILOT_FIXTURE_ACK = 'SYNTHETIC_LOOPBACK_TEST'
    $env:VIRGOSTARS_COPILOT_PREVIEW_STAGING_ENABLED = '1'
    $env:VIRGOSTARS_COPILOT_PREVIEW_STAGING_BACKEND_ORIGIN = $backend
    $env:VIRGOSTARS_COPILOT_PREVIEW_STAGING_TEST_BEARER = $testBearer

    $fixture = Start-Process -FilePath 'node' -ArgumentList @('scripts/copilot-staging-fixture.mjs', [string]$BackendPort) -WorkingDirectory $root -PassThru -NoNewWindow
    $capabilities = Wait-ForHttp -Url "$backend/api/v1/ai/copilot-preview/capabilities" -Headers @{
        Authorization = "Bearer $testBearer"
    }
    if ($capabilities.contract -ne 'VirgoStarsCopilotPreviewCapabilities' -or
        $capabilities.stage -ne 'STAGING_SYNTHETIC' -or
        $capabilities.providerEnabled -ne $false -or
        $capabilities.modelSelectorAvailable -ne $false) {
        throw 'Unexpected local capabilities response; refusing to start Tauri.'
    }
    Write-Host 'Synthetic local capabilities verified. Opening Tauri DEBUG (copilot-staging).'
    Write-Host 'Close the Tauri window to shut down the test processes.'
    # Official Tauri 2 CLI supports: tauri dev --features copilot-staging
    # The local Tauri binary sees the bearer; Angular dev process never inherits it.
    & $tauri dev --features copilot-staging
    if ($LASTEXITCODE -ne 0) { throw 'Tauri debug staging run failed.' }
}
finally {
    Stop-ChildTree $fixture
    Stop-ChildTree $frontendProcess
    foreach ($key in $labEnvKeys) {
        Remove-Item -Path ("Env:" + $key) -ErrorAction SilentlyContinue
    }
    Remove-Variable -Name testBearer -ErrorAction SilentlyContinue
    Pop-Location
    Write-Host 'Local synthetic AI lab stopped. No deploy, no merge, no real JWT.'
}
