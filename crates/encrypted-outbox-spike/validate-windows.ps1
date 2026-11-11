# VirgoStars Desktop — isolated SQLCipher synthetic test gate.
# This script does NOT read user accounts, app databases, tokens or production data.
# It only runs tracked synthetic tests in the current checkout. It does NOT
# automatically install toolchains, create lockfiles, merge, deploy or release.
[CmdletBinding()]
param(
    [switch]$SkipNode
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$crate = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $crate "..\..")).Path
$manifest = Join-Path $crate "Cargo.toml"
$lock = Join-Path $crate "Cargo.lock"
$failures = New-Object System.Collections.Generic.List[string]

function Run-Gate([string]$name, [string]$exe, [string[]]$arguments) {
    Write-Host ""
    Write-Host ("== {0} ==" -f $name)
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) {
        $failures.Add($name)
        Write-Warning ("FAILED: {0} (exit {1})" -f $name, $LASTEXITCODE)
    } else {
        Write-Host ("PASS: {0}" -f $name)
    }
}

if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
    throw "The encrypted outbox crate manifest was not found."
}
$rustc = Get-Command rustc -ErrorAction SilentlyContinue
$cargo = Get-Command cargo -ErrorAction SilentlyContinue
if ($null -eq $rustc -or $null -eq $cargo) {
    throw "Rust/Cargo missing. Install the Windows MSVC Rust toolchain manually; no automatic install is performed."
}
$versionLine = (& rustc --version)
if ($LASTEXITCODE -ne 0 -or $versionLine -notmatch 'rustc (\d+\.\d+\.\d+)') {
    throw "Unable to identify the Rust toolchain."
}
if ([version]$Matches[1] -lt [version]"1.89.0") {
    throw "This crate requires Rust 1.89.0 or newer. A newer toolchain may be required by other Tauri crates."
}
Run-Gate "Rust format" "cargo" @("fmt", "--manifest-path", $manifest, "--", "--check")
Run-Gate "Rust clippy" "cargo" @("clippy", "--manifest-path", $manifest, "--all-targets", "--", "-D", "warnings")

if (Test-Path -LiteralPath $lock -PathType Leaf) {
    Run-Gate "Rust SQLCipher tests (locked)" "cargo" @("test", "--manifest-path", $manifest, "--locked")
} else {
    Write-Warning "No reviewed Cargo.lock is present yet. Testing in discovery mode (NOT a reproducible release gate)."
    Run-Gate "Rust SQLCipher tests (unlocked discovery)" "cargo" @("test", "--manifest-path", $manifest)
    # A successful discovery-mode test can create Cargo.lock locally, but this
    # script never commits or approves it; review transitive dependencies first.
    $failures.Add("Missing reviewed Cargo.lock")
}

if (-not $SkipNode) {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $node) {
        $failures.Add("Node synthetic reference tests")
        Write-Warning "Node.js missing; reference tests were not run."
    } else {
        Run-Gate "SQLite synthetic persistence + schema references" "node" @(
            "--experimental-sqlite", "--test",
            (Join-Path $repo "tests\sqlite-outbox-reference.test.mjs"),
            (Join-Path $repo "tests\sqlite-schema-gate-reference.test.mjs"),
            (Join-Path $repo "tests\sqlite-dependent-revisions.test.mjs"),
            (Join-Path $repo "tests\sqlite-ack-ledger.test.mjs"),
            (Join-Path $repo "tests\sqlite-v2-migration-boundary.test.mjs")
        )
    }
}

Write-Host ""
if ($failures.Count -gt 0) {
    Write-Warning ("FAIL / NOT READY: {0}" -f ($failures -join "; "))
    Write-Host "Do not integrate with Tauri, real profiles or production until native encryption, key custody and migration gates pass."
    exit 1
}
Write-Host "PASS: local static and synthetic tests. This does NOT approve production encryption or real-data use."
exit 0
