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
    'VIRGOSTARS_COPILOT_FIXTURE_SESSION',
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
    # Probe by binding, not by CONNECTING to an unknown listener on the port.
    # ExclusiveAddressUse avoids accidentally sharing a port with another server.
    $listener = [System.Net.Sockets.TcpListener]::new(
        [System.Net.IPAddress]::Parse('127.0.0.1'), $Port)
    try {
        $listener.ExclusiveAddressUse = $true
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        $listener.Stop()
    }
}
function Read-LoopbackHttp {
    param([string] $Url, [hashtable] $Headers, [switch] $ExpectJson)
    # Explicitly bypass all system and inherited HTTP proxies and reject
    # redirects before attaching even a fictional bearer to a request.
    $uri = [System.Uri]::new($Url)
    if ($uri.Scheme -ne 'http' -or $uri.Host -ne '127.0.0.1' -or
        $uri.UserInfo -ne '' -or $uri.Query -ne '' -or $uri.Fragment -ne '' -or
        ($uri.AbsolutePath -ne '/' -and
         $uri.AbsolutePath -ne '/api/v1/ai/copilot-preview/capabilities')) {
        throw 'Only the fixed local synthetic lab GET endpoints are allowed.'
    }
    $request = [System.Net.HttpWebRequest] [System.Net.WebRequest]::Create($uri)
    $request.Proxy = $null
    $request.AllowAutoRedirect = $false
    $request.Timeout = 2000
    $request.ReadWriteTimeout = 2000
    $request.Method = 'GET'
    if ($ExpectJson) { $request.Accept = 'application/json' }
    if ($null -ne $Headers) {
        foreach ($item in $Headers.GetEnumerator()) {
            if ($item.Key -ne 'Authorization') { throw 'Unexpected HTTP lab header.' }
            $request.Headers['Authorization'] = [string] $item.Value
        }
    }
    $response = $request.GetResponse()
    try {
        if ($response.StatusCode -ne [System.Net.HttpStatusCode]::OK) {
            throw 'Local fixture returned a non-200 HTTP response.'
        }
        if (-not $ExpectJson) { return $true }
        $type = ([string] $response.ContentType -split ';')[0].Trim().ToLowerInvariant()
        if ($type -ne 'application/json' -or $response.ContentLength -gt 8192) {
            throw 'Local synthetic capabilities response rejected.'
        }
        $stream = $response.GetResponseStream()
        $memory = New-Object System.IO.MemoryStream
        $buffer = New-Object byte[] 1024
        # ReadWriteTimeout bounds EACH blocking Read, not an entire trickled
        # response. A local process sending one byte every second must never
        # keep the synthetic capabilities preflight alive indefinitely.
        $readClock = [System.Diagnostics.Stopwatch]::StartNew()
        $maxReadMilliseconds = 5000
        try {
            while ($true) {
                if ($readClock.ElapsedMilliseconds -ge $maxReadMilliseconds) {
                    throw 'Local synthetic capabilities response exceeded total read time.'
                }
                $read = $stream.Read($buffer, 0, $buffer.Length)
                if ($readClock.ElapsedMilliseconds -ge $maxReadMilliseconds) {
                    throw 'Local synthetic capabilities response exceeded total read time.'
                }
                if ($read -le 0) { break }
                if ($memory.Length + $read -gt 8192) {
                    throw 'Local synthetic capabilities response exceeds size limit.'
                }
                $memory.Write($buffer, 0, $read)
            }
            $content = [System.Text.Encoding]::UTF8.GetString($memory.ToArray())
            return ConvertFrom-Json -InputObject $content -ErrorAction Stop
        } finally {
            $readClock.Stop()
            $memory.Dispose()
            $stream.Dispose()
        }
    } finally {
        $response.Dispose()
    }
}
function Wait-ForHttp {
    param([string] $Url, [int] $LimitSeconds = 90,
        [hashtable] $Headers = @{}, [switch] $ExpectJson)
    $stopAt = (Get-Date).AddSeconds($LimitSeconds)
    do {
        try {
            $result = Read-LoopbackHttp -Url $Url -Headers $Headers -ExpectJson:$ExpectJson
            if ($null -ne $result) { return $result }
        } catch { # No exception content is printed, as it may contain headers.
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
    Invoke-Checked 'Complete AI bridge isolated smoke (native adapter, HTTP, decoder, lab)' 'npm.cmd' @('run', 'test:ai:smoke')
    Invoke-Checked 'Complete Node and TypeScript test suite' 'npm.cmd' @('test')
    Invoke-Checked 'Strict TypeScript AI IPC contract' 'npm.cmd' @('run', 'test:ai:types')
    Invoke-Checked 'Angular/Charts build prerequisites' 'npm.cmd' @('run', 'doctor:build')
    Invoke-Checked 'Prepare synthetic development icon' 'npm.cmd' @('run', 'prepare:icon')

    Push-Location (Join-Path $root 'src-tauri')
    try {
        Invoke-Checked 'Rust formatting' 'cargo' @('fmt', '--all', '--', '--check')
        # Both variants must compile: ordinary offline guest builds never
        # depend on the synthetic AI network feature, even in DEBUG mode.
        Invoke-Checked 'Rust offline default compile without AI' 'cargo' @('check', '--no-default-features')
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
    # Independent 128-bit per-launch challenge binds readiness to this fixture.
    # No value is logged or written to disk; it does not grant user access.
    $labSession = (& node -e "console.log(require('node:crypto').randomBytes(16).toString('hex'))").Trim()
    if ($LASTEXITCODE -ne 0 -or $labSession -notmatch '^[a-f0-9]{32}$') {
        throw 'Failed to generate a synthetic fixture session challenge.'
    }
    $env:VIRGOSTARS_COPILOT_FIXTURE_ACK = 'SYNTHETIC_LOOPBACK_TEST'
    $env:VIRGOSTARS_COPILOT_FIXTURE_SESSION = $labSession
    $env:VIRGOSTARS_COPILOT_PREVIEW_STAGING_ENABLED = '1'
    $env:VIRGOSTARS_COPILOT_PREVIEW_STAGING_BACKEND_ORIGIN = $backend
    $env:VIRGOSTARS_COPILOT_PREVIEW_STAGING_TEST_BEARER = $testBearer

    $fixture = Start-Process -FilePath 'node' -ArgumentList @('scripts/copilot-staging-fixture.mjs', [string]$BackendPort) -WorkingDirectory $root -PassThru -NoNewWindow
    $capabilities = Wait-ForHttp -Url "$backend/api/v1/ai/copilot-preview/capabilities" -ExpectJson -Headers @{
        Authorization = "Bearer $testBearer"
    }
    # Match the exact Rust staging allowlist; fail closed on a partial/mock
    # contract, extra action, missing planet or wrong test instance.
    $actions = @($capabilities.actions)
    $focusOptions = @($capabilities.focusOptions)
    $expectedFocus = @('NATAL:VENUS', 'NATAL:SUN', 'TRANSIT:SATURN')
    if ($capabilities.labSession -cne $labSession -or
        $capabilities.contract -cne 'VirgoStarsCopilotPreviewCapabilities' -or
        $capabilities.version -cne '0.1.0' -or
        $capabilities.stage -cne 'STAGING_SYNTHETIC' -or
        $capabilities.enabled -cne $true -or
        $capabilities.providerEnabled -cne $false -or
        $capabilities.modelSelectorAvailable -cne $false -or
        $actions.Count -ne 1 -or $actions[0] -cne 'describe_focus' -or
        $focusOptions.Count -ne 3) {
        throw 'Unexpected local capabilities response; refusing to start Tauri.'
    }
    foreach ($focusName in $expectedFocus) {
        if (-not ($focusOptions -ccontains $focusName)) {
            throw 'Unexpected local capabilities focus options; refusing to start Tauri.'
        }
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
    Remove-Variable -Name labSession -ErrorAction SilentlyContinue
    Pop-Location
    Write-Host 'Local synthetic AI lab stopped. No deploy, no merge, no real JWT.'
}
