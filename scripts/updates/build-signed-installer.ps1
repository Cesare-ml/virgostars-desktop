param(
  [Parameter(Mandatory=$true)][string]$PublicKeyFile
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $PublicKeyFile -PathType Leaf)) { throw 'File della chiave pubblica non trovato.' }
if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PATH) { throw 'Imposta TAURI_SIGNING_PRIVATE_KEY_PATH fuori dal repository.' }
$privatePath = [IO.Path]::GetFullPath($env:TAURI_SIGNING_PRIVATE_KEY_PATH)
$repositoryPath = [IO.Path]::GetFullPath((Get-Location).Path).TrimEnd('\') + '\'
if ($privatePath.StartsWith($repositoryPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'La chiave privata deve stare fuori dal repository.' }
if (-not (Test-Path -LiteralPath $privatePath -PathType Leaf)) { throw 'File della chiave privata non trovato.' }
$publicKey = (Get-Content -LiteralPath $PublicKeyFile -Raw).Trim()
if ($publicKey.Length -lt 40 -or $publicKey.Length -gt 2000) { throw 'Chiave pubblica non valida.' }
$env:VIRGOSTARS_UPDATER_PUBLIC_KEY = $publicKey
$env:TAURI_SIGNING_PRIVATE_KEY = $privatePath
try {
  New-Item -ItemType Directory -Force .local/updater | Out-Null
  $overlay = @{ bundle = @{ createUpdaterArtifacts = $true } } | ConvertTo-Json -Depth 5
  [IO.File]::WriteAllText((Join-Path (Get-Location) '.local/updater/tauri-release.conf.json'), $overlay, [Text.UTF8Encoding]::new($false))
  npm run verify:version
  if ($LASTEXITCODE -ne 0) { throw 'Versioni incoerenti.' }
  npm run build:installer -- --config .local/updater/tauri-release.conf.json
  if ($LASTEXITCODE -ne 0) { throw 'Build installer fallita.' }
} finally {
  Remove-Item Env:VIRGOSTARS_UPDATER_PUBLIC_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
}
