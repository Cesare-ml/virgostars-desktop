# Windows-only build launcher for the synthetic renderer proof of concept.
# Does not use VirgoStars credentials, production data, or original artwork.
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$desktop = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$charts = Join-Path (Split-Path $desktop -Parent) 'astrological-charts'
if (-not (Test-Path (Join-Path $charts 'package.json'))) {
    throw 'Clone the authorized private astrological-charts repository beside virgostars-desktop.'
}
foreach ($tool in @('node', 'npm', 'rustc', 'cargo')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool not found. See docs/SPIKE-001.md for Windows requirements."
    }
}
if (Test-Path (Join-Path $desktop '.local/frontend')) {
    throw 'Generated .local/frontend exists. Inspect and remove only that directory before rebuilding.'
}

Push-Location $charts
try {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'Charts npm ci failed.' }
    if (-not (Test-Path '.local/demo-pack/manifests/approved-assets.json')) {
        npm run demo:pack
        if ($LASTEXITCODE -ne 0) { throw 'Synthetic asset generation failed.' }
    }
    npm run build:library
    if ($LASTEXITCODE -ne 0) { throw 'Charts library build failed.' }
    npm run build:demo
    if ($LASTEXITCODE -ne 0) { throw 'Charts demo build failed.' }
}
finally { Pop-Location }

Push-Location $desktop
try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'Desktop npm install failed.' }
    npm test
    if ($LASTEXITCODE -ne 0) { throw 'Desktop Node tests failed.' }
    npm run prepare:frontend
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic offline asset staging failed.' }
    npm run tauri:build
    if ($LASTEXITCODE -ne 0) { throw 'Tauri desktop build failed.' }
    Write-Host 'Desktop Angular shell + Tauri build attempted. Inspect src-tauri/target/release.'
    Write-Host 'This is NOT an installer or production release; test offline WebView2 rendering on Windows.'
}
finally { Pop-Location }
