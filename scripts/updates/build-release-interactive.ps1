# Build locally with a protected Tauri updater key. Nothing is published.
param(
  [string]$PrivateKeyFile = (Join-Path $env:USERPROFILE 'VirgoStarsSigning\updater.key'),
  [string]$PublicKeyFile = (Join-Path $env:USERPROFILE 'VirgoStarsSigning\updater.key.pub')
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Set-Location -LiteralPath $root
if (-not (Test-Path -LiteralPath $PrivateKeyFile -PathType Leaf) -or
    -not (Test-Path -LiteralPath $PublicKeyFile -PathType Leaf)) {
  throw 'Chiave Tauri non trovata: crea o individua la coppia di chiavi prima di continuare.'
}
$version = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Versione stable non valida.' }
$notes = ".local/release-$version-notes.txt"
$output = ".local/release-$version-latest-stable.json"
if (-not (Test-Path -LiteralPath $notes -PathType Leaf)) { throw 'Note di release non trovate.' }
if (Test-Path -LiteralPath $output) { throw 'Manifest già esistente: spostalo manualmente prima di riprovare.' }
$bundle = Join-Path $root 'src-tauri\target\release\bundle\nsis'
if (Test-Path -LiteralPath $bundle) {
  $existing = @(Get-ChildItem -LiteralPath $bundle -File -Filter "*$version*x64-setup.exe")
  if ($existing.Count -ne 0) { throw 'Esiste già un installer per questa versione: conservalo altrove prima di ricompilare.' }
}
npm.cmd run verify:version
if ($LASTEXITCODE -ne 0) { throw 'Verifica della versione fallita.' }
node scripts/ephemeris/verify-staged-data.mjs
if ($LASTEXITCODE -ne 0) { throw 'Verifica delle effemeridi fallita.' }
$password = Read-Host 'Password della chiave Tauri (non sarà mostrata)' -AsSecureString
try {
  $env:TAURI_SIGNING_PRIVATE_KEY_PATH = [IO.Path]::GetFullPath($PrivateKeyFile)
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.Net.NetworkCredential]::new('', $password).Password
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'scripts/updates/build-signed-installer.ps1' -PublicKeyFile $PublicKeyFile
  if ($LASTEXITCODE -ne 0) { throw 'Build firmata non riuscita.' }
} finally {
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue
  Remove-Variable password -ErrorAction SilentlyContinue
}
$installers = @(Get-ChildItem -LiteralPath $bundle -File -Filter "*$version*x64-setup.exe")
if ($installers.Count -ne 1) { throw 'Impossibile identificare un unico installer.' }
$installer = $installers[0].FullName
$signature = "$installer.sig"
if (-not (Test-Path -LiteralPath $signature -PathType Leaf)) { throw 'Firma Tauri non trovata.' }
try {
  $env:VIRGOSTARS_VERIFY_INSTALLER = $installer
  $env:VIRGOSTARS_VERIFY_SIGNATURE = $signature
  $env:VIRGOSTARS_VERIFY_PUBLIC_KEY = [IO.Path]::GetFullPath($PublicKeyFile)
  cargo test --locked --offline --manifest-path src-tauri/Cargo.toml updater::tests::verify_built_release_artifact -- --ignored --exact
  if ($LASTEXITCODE -ne 0) { throw 'Verifica crittografica della firma non riuscita.' }
} finally {
  Remove-Item Env:VIRGOSTARS_VERIFY_INSTALLER, Env:VIRGOSTARS_VERIFY_SIGNATURE, Env:VIRGOSTARS_VERIFY_PUBLIC_KEY -ErrorAction SilentlyContinue
}
node scripts/updates/prepare-manifest.mjs --channel stable --installer $installer --signature $signature --notes $notes --output $output
if ($LASTEXITCODE -ne 0) { throw 'Preparazione del manifest non riuscita.' }
Write-Output 'Installer, firma Tauri e manifest stable pronti in locale. Nessuna pubblicazione eseguita.'
Write-Output "Installer: $installer"
Write-Output "Firma: $signature"
Write-Output "Manifest: $output"
