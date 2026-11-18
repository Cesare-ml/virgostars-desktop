param([string]$TestRoot = (Join-Path $env:TEMP ('virgostars-updater-test-' + [guid]::NewGuid().ToString('N'))), [switch]$UseExistingFrontend)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath 'src-tauri/tauri.conf.json')) { throw 'Run from the Desktop repository root.' }
if (Test-Path -LiteralPath $TestRoot) { throw 'Test root already exists; refusing to overwrite.' }
$TestRoot = [IO.Path]::GetFullPath($TestRoot)
New-Item -ItemType Directory -Path $TestRoot | Out-Null
$id = [guid]::NewGuid().ToString('N')
$short = $id.Substring(0,8)
$fixtureDir = Join-Path (Get-Location) ".local/updater-loopback-$id"
New-Item -ItemType Directory -Path "$fixtureDir/places", "$fixtureDir/ephemeris" | Out-Null
[IO.File]::WriteAllText("$fixtureDir/places/world-cities.sqlite", 'synthetic city catalog')
[IO.File]::WriteAllText("$fixtureDir/ephemeris/de441-slice.eph", 'synthetic ephemeris fixture')
$openssl = (Get-Command openssl.exe -ErrorAction Stop).Source
# OpenSSL writes progress to stderr even on success; no key material is printed or logged.
$ErrorActionPreference = 'Continue'
& $openssl req -x509 -newkey rsa:2048 -nodes -keyout "$TestRoot/ca.key" -out "$TestRoot/ca.pem" -days 1 -subj '/CN=VirgoStars isolated test CA' -addext 'basicConstraints=critical,CA:TRUE' 2>$null
if ($LASTEXITCODE) { throw 'Test CA generation failed.' }
& $openssl req -new -newkey rsa:2048 -nodes -keyout "$TestRoot/server.key" -out "$TestRoot/server.csr" -subj '/CN=localhost' 2>$null
if ($LASTEXITCODE) { throw 'Test certificate request failed.' }
[IO.File]::WriteAllText("$TestRoot/extensions.cnf", "subjectAltName=DNS:localhost`nbasicConstraints=critical,CA:FALSE`nextendedKeyUsage=serverAuth`n")
& $openssl x509 -req -in "$TestRoot/server.csr" -CA "$TestRoot/ca.pem" -CAkey "$TestRoot/ca.key" -CAcreateserial -out "$TestRoot/server.pem" -days 1 -extfile "$TestRoot/extensions.cnf" 2>$null
if ($LASTEXITCODE) { throw 'Test certificate signing failed.' }
$ErrorActionPreference = 'Stop'
& .\node_modules\.bin\tauri.cmd signer generate --ci -p 'disposable-test-only' -w "$TestRoot/sign.key" *> $null
if ($LASTEXITCODE) { throw 'Disposable signing key generation failed.' }
$public = (Get-Content "$TestRoot/sign.key.pub" -Raw).Trim()
$env:VIRGOSTARS_UPDATER_PUBLIC_KEY = $public
$env:VIRGOSTARS_UPDATER_LOOPBACK_CA = Get-Content "$TestRoot/ca.pem" -Raw
$env:VIRGOSTARS_UPDATER_TEST_CHANNEL = '1'
$env:TAURI_SIGNING_PRIVATE_KEY = "$TestRoot/sign.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = 'disposable-test-only'
try {
  if ($UseExistingFrontend) {
    if (-not (Test-Path -LiteralPath 'dist/desktop/browser/index.html' -PathType Leaf)) { throw 'Prebuilt frontend is missing.' }
  } else {
    npm run build:ui
    if ($LASTEXITCODE) { throw 'Synthetic frontend build failed.' }
  }
  npm run prepare:icon
  if ($LASTEXITCODE) { throw 'Icon preparation failed.' }
  foreach ($version in @('0.0.2', '0.0.3')) {
    $overlay = @{
      productName = "VirgoStars Updater Test $short"
      identifier = "it.virgostars.desktop.updatertest.$id"
      version = $version
      plugins = @{ updater = @{ pubkey = $public } }
      bundle = @{ active = $true; createUpdaterArtifacts = $true; resources = @{
        "../.local/updater-loopback-$id/places/world-cities.sqlite" = 'places/world-cities.sqlite'
        "../.local/updater-loopback-$id/ephemeris/de441-slice.eph" = 'ephemeris/de441-slice.eph'
      } }
    } | ConvertTo-Json -Depth 10
    [IO.File]::WriteAllText("$TestRoot/overlay.json", $overlay, [Text.UTF8Encoding]::new($false))
    & .\node_modules\.bin\tauri.cmd build --debug --bundles nsis --features updater-loopback-test --config "$TestRoot/overlay.json"
    if ($LASTEXITCODE) { throw "Test installer $version failed." }
    $name = if ($version -eq '0.0.2') { '002' } else { '003' }
    $built = "src-tauri/target/debug/bundle/nsis/VirgoStars Updater Test ${short}_${version}_x64-setup.exe"
    Copy-Item -LiteralPath $built -Destination "$TestRoot/$name.exe"
    Copy-Item -LiteralPath "$built.sig" -Destination "$TestRoot/$name.exe.sig"
  }
  [IO.File]::WriteAllText("$TestRoot/mode.txt", 'same')
  [IO.File]::WriteAllText("$TestRoot/identifier.txt", "it.virgostars.desktop.updatertest.$id")
  Write-Output "Test root: $TestRoot"
  Write-Output 'Only synthetic data and disposable keys were used; these debug installers must not be distributed.'
} finally {
  Remove-Item Env:VIRGOSTARS_UPDATER_PUBLIC_KEY, Env:VIRGOSTARS_UPDATER_LOOPBACK_CA, Env:VIRGOSTARS_UPDATER_TEST_CHANNEL, Env:TAURI_SIGNING_PRIVATE_KEY, Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}
