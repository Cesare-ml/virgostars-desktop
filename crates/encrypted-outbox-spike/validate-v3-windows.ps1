# Manual VirgoStars Desktop v3 synthetic storage gate; Windows PowerShell 5.1+
# Runs tracked fictional tests only. Never touches accounts, real archives,
# production, installs toolchains, pushes GitHub changes, or deploys.
[CmdletBinding()]
param(
    # Explicit opt-in for reference-only checks when Cargo/MSVC is unavailable.
    [switch]$ReferenceOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$crate = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $crate '..\..')).Path
$sourceLockGate = Join-Path $repo 'tools\v3-verify-source-lock.mjs'
$nodeGate = Join-Path $repo 'tools\v3-sqlite-reference-gate.mjs'
$nativeGate = Join-Path $crate 'validate-windows.ps1'

if (-not (Test-Path -LiteralPath $nodeGate -PathType Leaf)) {
    throw 'Missing v3 Node reference gate. Use the complete reviewed checkout.'
}
$node = Get-Command 'node' -ErrorAction SilentlyContinue
if ($null -eq $node) {
    throw 'Node 22+ is required for the v3 SQLite reference gate.'
}
if (-not (Test-Path -LiteralPath $sourceLockGate -PathType Leaf)) {
    throw 'Missing reviewed v3 source-lock verifier. Use the complete checkout.'
}
Write-Host '== VirgoStars Desktop reviewed v3 SQL/test source fingerprints =='
& $node.Source $sourceLockGate
if ($LASTEXITCODE -ne 0) {
    throw 'v3 source-lock verification FAILED; no test result can override this.'
}
Write-Host '== VirgoStars Desktop v3 synthetic SQLite reference =='
& $node.Source $nodeGate
if ($LASTEXITCODE -ne 0) {
    throw 'v3 SQLite reference gate FAILED; native testing cannot override this failure.'
}

if ($ReferenceOnly) {
    Write-Warning 'REFERENCE-ONLY PASS. Rust, SQLCipher, encryption, migration and recovery have NOT been checked.'
    exit 0
}

# Never silently report release readiness without the native SQLCipher gate.
if (-not (Test-Path -LiteralPath $nativeGate -PathType Leaf)) {
    throw 'Missing native Windows SQLCipher validation script.'
}
$rustc = Get-Command 'rustc' -ErrorAction SilentlyContinue
$cargo = Get-Command 'cargo' -ErrorAction SilentlyContinue
if ($null -eq $rustc -or $null -eq $cargo) {
    throw 'Cargo/rustc missing; use -ReferenceOnly for the explicitly partial SQLite gate.'
}

Write-Host '== VirgoStars Desktop native Rust/SQLCipher validation =='
# The base native gate checks Cargo fmt, Clippy, SQLCipher tests and the
# reviewed Cargo.lock requirement. -SkipNode avoids duplicate older suites.
& $nativeGate -SkipNode
if ($LASTEXITCODE -ne 0) {
    throw 'Native SQLCipher gate FAILED or missing a reviewed Cargo.lock.'
}
Write-Host 'PASS: v3 reference and native test commands completed.'
Write-Warning 'This does NOT authorize production data, account access, migrations, a signed installer or release.'
exit 0
