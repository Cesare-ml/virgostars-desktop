# Publishes the next Desktop patch and the corresponding Pages frontend.
# Run explicitly from a trusted interactive Windows PowerShell session.
param(
  [switch]$CheckOnly,
  [string]$Notes = '',
  [switch]$DesktopOnly,
  [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
$desktop = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$website = [IO.Path]::GetFullPath((Join-Path $desktop '..\virgo-stars'))
$charts = [IO.Path]::GetFullPath((Join-Path $desktop '..\astrological-charts'))
$repository = 'Cesare-ml/virgostars-desktop'
$api = 'https://api.github.com'
$wrangler = 'wrangler@4.165.0'
$stateFile = Join-Path $desktop '.local\release-pipeline.json'
$webFile = Join-Path $website 'frontend\src\app\components\virgostars-desktop\desktop-release.ts'
$webDist = Join-Path $website 'dist\virgostars.it\browser'
$headers = $null
if ($CheckOnly -and $PrepareOnly) { throw 'Usa CheckOnly oppure PrepareOnly, non entrambi.' }

function Native([string]$name, [string[]]$arguments) {
  & $name @arguments
  if ($LASTEXITCODE -ne 0) { throw "Comando non riuscito: $name" }
}
function Invoke-Git([string]$root, [string[]]$arguments) {
  $value = & git -C $root @arguments
  if ($LASTEXITCODE -ne 0) { throw 'Comando Git non riuscito.' }
  return $value
}
function Clean([string]$root, [string]$label) {
  $status = @(Invoke-Git $root @('status','--porcelain','--untracked-files=normal'))
  if ($label -eq 'Desktop') { $status = @($status | Where-Object { $_ -ne '?? .worktrees/' }) }
  if ($status.Count -gt 0) { throw "$label contiene modifiche non registrate: salvale in un commit prima della release. Lo script non le aggiunge automaticamente." }
}
function Security-Preflight {
  # The site's production runbook blocks public deploys while known private
  # key / device environment files are tracked. Never read their contents.
  $tracked = @(Invoke-Git $website @('ls-files','--','backend/private.key','astrolabio/backend/scripts/e-ink-updater/13.3p/.env'))
  if ($tracked.Count) { throw 'Preflight sicurezza bloccato: il repository del sito conserva file sensibili tracciati. Segui docs/SECURITY.md e docs/deployment/PRODUCTION_CHANGE_SAFETY.md prima della pubblicazione.' }
}
function Save-State($state) {
  [IO.File]::WriteAllText($stateFile, ($state | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
}
function Github([string]$method, [string]$url, $body = $null, [string]$file = '') {
  try {
    if ($file) { return Invoke-RestMethod -Method $method -Uri $url -Headers $headers -ContentType 'application/octet-stream' -InFile $file }
    if ($null -ne $body) { return Invoke-RestMethod -Method $method -Uri $url -Headers $headers -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 10 -Compress) }
    return Invoke-RestMethod -Method $method -Uri $url -Headers $headers
  } catch { throw "Operazione GitHub non riuscita ($method). Verifica accesso e permessi; nessuna credenziale viene mostrata." }
}
function Upload([long]$releaseId, [string]$path, [string]$name) {
  $encoded = [Uri]::EscapeDataString($name)
  return Github 'POST' "https://uploads.github.com/repos/$repository/releases/$releaseId/assets?name=$encoded" $null $path
}
function Auth-Github {
  # The credential remains in this process; never print it, put it in argv or save it.
  $credential = @('protocol=https','host=github.com','','') | & git -c credential.interactive=never credential fill 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'Accesso GitHub non disponibile nel gestore credenziali Git. Esegui prima un accesso GitHub con Git.' }
  $entry = @($credential | Where-Object { $_ -like 'password=*' })
  if ($entry.Count -ne 1 -or $entry[0].Length -le 9) { throw 'Credenziale GitHub non disponibile.' }
  $token = $entry[0].Substring(9)
  $script:headers = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28'; 'User-Agent' = 'VirgoStars-Desktop-Release' }
  Remove-Variable credential,entry,token -ErrorAction SilentlyContinue
}
function Release-Asset($release, [string]$name) {
  $assets = @($release.assets | Where-Object { $_.name -ceq $name -and $_.state -eq 'uploaded' })
  if ($assets.Count -ne 1) { throw "Asset GitHub non univoco: $name" }
  return $assets[0]
}
function Write-Utf8([string]$path, [string]$value) {
  [IO.File]::WriteAllText($path, $value, [Text.UTF8Encoding]::new($false))
}

Set-Location -LiteralPath $desktop
if (-not (Test-Path -LiteralPath $charts -PathType Container)) { throw 'Serve il checkout fratello astrological-charts.' }
if (-not $DesktopOnly -and -not (Test-Path -LiteralPath $website -PathType Container)) { throw 'Serve il checkout fratello virgo-stars.' }
Auth-Github
$repoInfo = Github 'GET' "$api/repos/$repository"
if (-not $repoInfo.permissions.push) { throw 'La credenziale GitHub non ha permesso di scrittura sul repository Desktop.' }
$stable = Github 'GET' "$api/repos/$repository/releases/tags/updates-stable"
if (-not $DesktopOnly) {
  $env:CLOUDFLARE_ACCOUNT_ID = 'e7585de9131cd71bc008af5d61847a0e'
  Push-Location $website
  try {
    $projects = & npm.cmd exec --offline -- $wrangler pages project list --json
    if ($LASTEXITCODE -ne 0) { throw 'Accesso al progetto Cloudflare Pages non disponibile.' }
    $pages = @(($projects -join "`n") | ConvertFrom-Json | Where-Object { $_.'Project Name' -ceq 'virgostars' -and $_.'Project Domains' -match 'virgostars\.pages\.dev' })
    if ($pages.Count -ne 1) { throw 'Progetto Pages virgostars non trovato nel conto previsto.' }
  } finally { Pop-Location }
}
if ($CheckOnly) {
  $null = Release-Asset $stable 'latest.json'
  if ($DesktopOnly) { Write-Output 'Connessione GitHub disponibile. Sito escluso. Nessuna pubblicazione eseguita.' }
  else { Write-Output 'Connessione GitHub e Wrangler disponibili. Nessuna pubblicazione eseguita.'; Security-Preflight }
  Clean $desktop 'Desktop'; Clean $charts 'Grafica'
  if (-not $DesktopOnly) { Clean $website 'Sito' }
  Write-Output 'Checkout puliti: pronti per la preparazione.'
  exit 0
}

if (Test-Path -LiteralPath $stateFile -PathType Leaf) {
  $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  if ($state.schema -ne 1 -or $state.desktop -cne $desktop -or $state.website -cne $website -or $state.charts -cne $charts -or $state.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Stato release non valido: non proseguo.' }
  if ([bool]$state.desktopOnly -ne [bool]$DesktopOnly) { throw 'La modalità di rilascio non coincide con quella salvata: riprendi con gli stessi parametri.' }
  if ($state.phase -notin @('prepared','versioned','source-pushed','built','web-built','web-committed','creating-draft','draft','uploaded','published','updater-publishing','updater-published','site-published','complete')) { throw 'Fase release non riconosciuta: non proseguo.' }
  if ($PrepareOnly -and $state.phase -notin @('prepared','versioned','source-pushed')) { throw 'La release è già oltre la preparazione: PrepareOnly non pubblica e non la riprende.' }
  Write-Output "Ripresa release v$($state.version) dalla fase $($state.phase)."
} else {
  $null = Release-Asset $stable 'latest.json'
  if (-not $DesktopOnly) { Security-Preflight }
  Clean $desktop 'Desktop'; Clean $charts 'Grafica'
  if (-not $DesktopOnly) { Clean $website 'Sito' }
  $version = (& node 'scripts/updates/release-version.mjs' '--next')
  if ($LASTEXITCODE -ne 0 -or $version -notmatch '^\d+\.\d+\.\d+$') { throw 'Versione non valida.' }
  $tag = "v$version"
  if ($Notes.Length -gt 3000) { throw 'Note di release troppo lunghe.' }
  $existingFiles = @(Get-ChildItem -LiteralPath 'src-tauri\target\release\bundle\nsis' -File -Filter "*$version*x64-setup.exe" -ErrorAction SilentlyContinue)
  if ($existingFiles.Count -or (Test-Path -LiteralPath ".local\release-$version-latest-stable.json") -or (Test-Path -LiteralPath ".local\release-$version-automatic")) { throw 'Esistono già artifact locali per questa versione. Non verranno sostituiti.' }
  # Never replace an existing release, tag, or branch.
  $tags = @(Invoke-Git $desktop @('ls-remote','--tags','origin',"refs/tags/$tag"))
  $branches = @(Invoke-Git $desktop @('ls-remote','--heads','origin',"refs/heads/releases/$tag"))
  if ($tags.Count -or $branches.Count) { throw "Tag o branch $tag già esistente: non verrà sovrascritto." }
  for ($pageNumber = 1; $pageNumber -le 10; $pageNumber++) {
    $existingReleases = @(Github 'GET' "$api/repos/$repository/releases?per_page=100&page=$pageNumber")
    if (@($existingReleases | Where-Object { $_.tag_name -ceq $tag }).Count) { throw "Release $tag già esistente: non verrà sovrascritta." }
    if ($existingReleases.Count -lt 100) { break }
    if ($pageNumber -eq 10) { throw 'Elenco release troppo lungo: verifica manuale necessaria.' }
  }
  $chartCommit = (Invoke-Git $charts @('rev-parse','HEAD') | Select-Object -First 1).Trim()
  $null = Github 'GET' "$api/repos/Cesare-ml/astrological-charts/commits/$chartCommit"
  $snapshot = ''
  if (-not $DesktopOnly) {
    $snapshot = Join-Path $desktop ".local\release-$version-web-assets"
    $live = Invoke-WebRequest -Uri ("https://virgostars.pages.dev/?release-preflight=" + [Guid]::NewGuid().ToString('N')) -UseBasicParsing -TimeoutSec 30
    $main = [regex]::Match($live.Content, 'main-[A-Z0-9]{8,}\.js').Value
    Native 'node' @('scripts/updates/release-site-assets.mjs','snapshot',$webDist,$snapshot,$main)
  }
  $state = [pscustomobject]@{schema=1;desktop=$desktop;website=$website;charts=$charts;desktopOnly=[bool]$DesktopOnly;version=$version;phase='prepared';chartCommit=$chartCommit;snapshot=$snapshot;releaseId=0;installer='';assetName='';sha256='';sigHash='';manifestHash='';oldStableId=0}
  Save-State $state
}
$version = $state.version
$tag = "v$version"
$notesPath = Join-Path $desktop ".local\release-$version-notes.txt"
$manifestPath = Join-Path $desktop ".local\release-$version-latest-stable.json"
$releaseDir = Join-Path $desktop ".local\release-$version-automatic"
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

if ($state.phase -eq 'prepared') {
  $current = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
  if ($current -cne $version) { Native 'node' @('scripts/updates/release-version.mjs','--bump',$version) }
  $versionFiles = @('package.json','package-lock.json','src-tauri/Cargo.toml','src-tauri/Cargo.lock','src-tauri/tauri.conf.json','scripts/verify-tauri-security-config.mjs')
  Native 'git' (@('-C',$desktop,'add','--') + $versionFiles)
  & git -C $desktop diff --cached --quiet
  if ($LASTEXITCODE -eq 1) { Native 'git' @('-C',$desktop,'commit','-m',"chore: prepare desktop $tag") }
  elseif ($LASTEXITCODE -ne 0) { throw 'Impossibile controllare il commit della versione.' }
  $state.phase='versioned'; Save-State $state
}
if ($state.phase -eq 'versioned') {
  $commit = (Invoke-Git $desktop @('rev-parse','HEAD') | Select-Object -First 1).Trim()
  $remoteBranch = @(Invoke-Git $desktop @('ls-remote','--heads','origin',"refs/heads/releases/$tag"))
  if ($remoteBranch.Count -eq 0) { Native 'git' @('-C',$desktop,'push',"--force-with-lease=refs/heads/releases/$tag`:",'origin',"${commit}:refs/heads/releases/$tag") }
  elseif ($remoteBranch.Count -ne 1 -or -not $remoteBranch[0].StartsWith("$commit`t")) { throw 'Il branch release remoto contiene un commit diverso.' }
  $state | Add-Member -NotePropertyName desktopCommit -NotePropertyValue $commit -Force
  $state.phase='source-pushed'; Save-State $state
}
if ($state.phase -eq 'source-pushed') {
  Clean $desktop 'Desktop'; Clean $charts 'Grafica'
  if ((Invoke-Git $desktop @('rev-parse','HEAD') | Select-Object -First 1).Trim() -cne $state.desktopCommit -or (Invoke-Git $charts @('rev-parse','HEAD') | Select-Object -First 1).Trim() -cne $state.chartCommit) { throw 'Il codice sorgente è cambiato durante la release.' }
  $publicKey = Join-Path $env:USERPROFILE 'VirgoStarsSigning\updater.key.pub'
  $previousUpdaterConfig = Join-Path $desktop '.local\updater\tauri-release.conf.json'
  if (-not (Test-Path -LiteralPath $publicKey -PathType Leaf) -or -not (Test-Path -LiteralPath $previousUpdaterConfig -PathType Leaf)) { throw 'Impossibile confrontare la chiave updater con la configurazione della build precedente.' }
  $previousKey = (Get-Content -LiteralPath $previousUpdaterConfig -Raw | ConvertFrom-Json).plugins.updater.pubkey
  if ($previousKey -cne (Get-Content -LiteralPath $publicKey -Raw).Trim()) { throw 'La chiave updater non coincide con la configurazione precedente.' }
  Push-Location $charts
  try { Native 'npm.cmd' @('run','build:library') } finally { Pop-Location }
  if (-not (Test-Path -LiteralPath $notesPath)) {
    $summary = if ($Notes.Trim()) { $Notes.Trim() } else { "Aggiornamento VirgoStars Desktop $version." }
    Write-Utf8 $notesPath ("VirgoStars Desktop $version — anteprima Windows`n`n$summary`n")
  }
  if ($PrepareOnly) {
    Write-Output "Preparazione $tag completata. Esegui scripts/updates/build-release-interactive.ps1 in PowerShell per firmare l'installer, poi riprendi con gli stessi parametri di modalità."
    exit 0
  }
  if (-not (Test-Path -LiteralPath $manifestPath)) {
    $existingInstallers = @(Get-ChildItem -LiteralPath 'src-tauri\target\release\bundle\nsis' -File -Filter "*$version*x64-setup.exe" -ErrorAction SilentlyContinue)
    if ($existingInstallers.Count -eq 0) {
      Native 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/updates/build-release-interactive.ps1')
    } elseif ($existingInstallers.Count -eq 1) {
      $existing = $existingInstallers[0].FullName
      $keyPath = Join-Path $env:USERPROFILE 'VirgoStarsSigning\updater.key'
      $pubPath = Join-Path $env:USERPROFILE 'VirgoStarsSigning\updater.key.pub'
      if (-not (Test-Path -LiteralPath $keyPath -PathType Leaf) -or -not (Test-Path -LiteralPath $pubPath -PathType Leaf)) { throw 'Chiave updater non trovata.' }
      if (-not (Test-Path -LiteralPath "$existing.sig" -PathType Leaf)) {
        $password = Read-Host 'Password della chiave Tauri (non sarà mostrata)' -AsSecureString
        try {
          $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.Net.NetworkCredential]::new('', $password).Password
          Native 'npm.cmd' @('exec','--offline','--','tauri','signer','sign','--private-key-path',$keyPath,'--app-version',$version,$existing)
        } finally { Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue; Remove-Variable password -ErrorAction SilentlyContinue }
      }
      try {
        $env:VIRGOSTARS_VERIFY_INSTALLER=$existing; $env:VIRGOSTARS_VERIFY_SIGNATURE="$existing.sig"; $env:VIRGOSTARS_VERIFY_PUBLIC_KEY=$pubPath
        Native 'cargo' @('test','--locked','--offline','--manifest-path','src-tauri/Cargo.toml','updater::tests::verify_built_release_artifact','--','--ignored','--exact')
      } finally { Remove-Item Env:VIRGOSTARS_VERIFY_INSTALLER,Env:VIRGOSTARS_VERIFY_SIGNATURE,Env:VIRGOSTARS_VERIFY_PUBLIC_KEY -ErrorAction SilentlyContinue }
      Native 'node' @('scripts/updates/prepare-manifest.mjs','--channel','stable','--installer',$existing,'--signature',"$existing.sig",'--notes',$notesPath,'--output',$manifestPath)
    } else { throw 'Più installer per la stessa versione: non procedo.' }
  }
  $files = @(Get-ChildItem -LiteralPath 'src-tauri\target\release\bundle\nsis' -File -Filter "*$version*x64-setup.exe")
  if ($files.Count -ne 1 -or -not (Test-Path -LiteralPath "$($files[0].FullName).sig")) { throw 'Installer o firma non disponibili.' }
  $state.installer=$files[0].FullName
  $state.assetName=$files[0].Name.Replace(' ','.')
  $state.sha256=(Get-FileHash -LiteralPath $state.installer -Algorithm SHA256).Hash.ToLowerInvariant()
  $state.sigHash=(Get-FileHash -LiteralPath "$($state.installer).sig" -Algorithm SHA256).Hash.ToLowerInvariant()
  $state.manifestHash=(Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $state.phase='built'; Save-State $state
}
# BEGIN TESTABLE DESKTOP-ONLY BUILT TRANSITION
if ($state.phase -eq 'built' -and $DesktopOnly) {
  $state.phase='web-committed'; Save-State $state
}
# END TESTABLE DESKTOP-ONLY BUILT TRANSITION
if ($state.phase -eq 'built') {
  $status = @(Invoke-Git $website @('status','--porcelain','--untracked-files=normal'))
  if (@($status | Where-Object { $_ -notmatch '^ M frontend/src/app/components/virgostars-desktop/desktop-release\.ts$' }).Count) { throw 'Il checkout del sito contiene altre modifiche: la build non verrà pubblicata.' }
  if ((Get-FileHash -LiteralPath $state.installer -Algorithm SHA256).Hash.ToLowerInvariant() -cne $state.sha256) { throw 'Installer cambiato dopo la firma.' }
  Native 'node' @('scripts/updates/release-web-manifest.mjs',$webFile,$version,$state.assetName,$state.sha256)
  Push-Location $website
  try { Native 'npm.cmd' @('run','build:frontend') } finally { Pop-Location }
  Native 'node' @('scripts/updates/release-site-assets.mjs','restore',$webDist,$state.snapshot)
  $state.phase='web-built'; Save-State $state
}
if ($state.phase -eq 'web-built') {
  $status = @(Invoke-Git $website @('status','--porcelain','--untracked-files=normal'))
  if ($status.Count -gt 1 -or ($status.Count -eq 1 -and $status[0] -notmatch '^ M frontend/src/app/components/virgostars-desktop/desktop-release\.ts$')) { throw 'Il checkout del sito contiene altre modifiche; non verranno pubblicate automaticamente.' }
  if ($status.Count -eq 1) {
    Native 'git' @('-C',$website,'add','--','frontend/src/app/components/virgostars-desktop/desktop-release.ts')
    Native 'git' @('-C',$website,'commit','-m',"chore: update desktop download $tag")
  }
  $siteCommit=(Invoke-Git $website @('rev-parse','HEAD') | Select-Object -First 1).Trim()
  $state | Add-Member -NotePropertyName siteCommit -NotePropertyValue $siteCommit -Force
  $state.phase='web-committed'; Save-State $state
}
if ($state.phase -eq 'web-committed') {
  $state.phase='creating-draft'; Save-State $state
}
if ($state.phase -eq 'creating-draft') {
  $info = @{tag_name=$tag;target_commitish=$state.desktopCommit;name="VirgoStars Desktop $tag";body=((Get-Content -LiteralPath $notesPath -Raw) + "`nRenderer commit: $($state.chartCommit)`n");draft=$true;prerelease=$false}
  $found=@()
  for ($pageNumber=1; $pageNumber -le 10; $pageNumber++) {
    $all = @(Github 'GET' "$api/repos/$repository/releases?per_page=100&page=$pageNumber")
    $found += @($all | Where-Object { $_.tag_name -ceq $tag })
    if ($all.Count -lt 100) { break }
    if ($pageNumber -eq 10) { throw 'Elenco release troppo lungo.' }
  }
  if ($found.Count -gt 1) { throw 'Release duplicata.' }
  if ($found.Count -eq 1) {
    $created=$found[0]
    if (-not $created.draft -or $created.target_commitish -cne $state.desktopCommit -or $created.body -cne $info.body) { throw 'La release esistente non corrisponde alla preparazione corrente.' }
  } else { $created = Github 'POST' "$api/repos/$repository/releases" $info }
  $state.releaseId=$created.id; $state.phase='draft'; Save-State $state
}
if ($state.phase -eq 'draft') {
  $draft = Github 'GET' "$api/repos/$repository/releases/$($state.releaseId)"
  if (-not $draft.draft -or $draft.tag_name -cne $tag) { throw 'Release di lavoro inattesa.' }
  $installCopy = Join-Path $releaseDir $state.assetName
  $signCopy = "$installCopy.sig"
  if (-not (Test-Path -LiteralPath $installCopy)) { Copy-Item -LiteralPath $state.installer -Destination $installCopy }
  if (-not (Test-Path -LiteralPath $signCopy)) { Copy-Item -LiteralPath "$($state.installer).sig" -Destination $signCopy }
  if ((Get-FileHash -LiteralPath $installCopy -Algorithm SHA256).Hash.ToLowerInvariant() -cne $state.sha256) { throw 'Copia installer alterata.' }
  $sumPath = Join-Path $releaseDir 'sha256sums.txt'
  $sigHash = (Get-FileHash -LiteralPath $signCopy -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sigHash -cne $state.sigHash -or (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $state.manifestHash) { throw 'Firma o manifest cambiati dopo la build.' }
  Write-Utf8 $sumPath ("$($state.sha256)  $($state.assetName)`n$sigHash  $($state.assetName).sig`n")
  foreach ($asset in @(@($installCopy,$state.assetName,$state.sha256),@($signCopy,"$($state.assetName).sig",$sigHash),@($sumPath,'sha256sums.txt',(Get-FileHash -LiteralPath $sumPath -Algorithm SHA256).Hash.ToLowerInvariant()))) {
    $existing = @($draft.assets | Where-Object { $_.name -ceq $asset[1] })
    if ($existing.Count -gt 1) { throw 'Asset duplicato.' }
    if ($existing.Count -eq 0) { $uploaded = Upload $state.releaseId $asset[0] $asset[1] } else { $uploaded=$existing[0] }
    if ($uploaded.digest -cne "sha256:$($asset[2])") { throw "Checksum GitHub non corrispondente: $($asset[1])" }
  }
  $state.phase='uploaded'; Save-State $state
}
if ($state.phase -eq 'uploaded') {
  $published = Github 'PATCH' "$api/repos/$repository/releases/$($state.releaseId)" @{draft=$false;prerelease=$false}
  if ($published.draft -or $published.tag_name -cne $tag) { throw 'Pubblicazione release non confermata.' }
  $state.phase='published'; Save-State $state
}
if ($state.phase -eq 'published') {
  try { $null = Invoke-WebRequest -Uri "https://github.com/$repository/releases/download/$tag/$($state.assetName)" -Method Head -UseBasicParsing -TimeoutSec 30 } catch { throw 'Installer pubblicato non raggiungibile: manifest stable non modificato.' }
  $stable = Github 'GET' "$api/repos/$repository/releases/tags/updates-stable"
  $old = Release-Asset $stable 'latest.json'
  $newManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $expected = "https://github.com/$repository/releases/download/$tag/$($state.assetName)"
  $sig = (Get-Content -LiteralPath "$($state.installer).sig" -Raw).Trim()
  if ($newManifest.version -cne $version -or $newManifest.platforms.'windows-x86_64'.url -cne $expected -or $newManifest.platforms.'windows-x86_64'.signature -cne $sig -or (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $state.manifestHash) { throw 'Manifest updater non coerente con la release.' }
  $state.oldStableId=$old.id; $state.phase='updater-publishing'; Save-State $state
}
# BEGIN TESTABLE STABLE MANIFEST TRANSITION
if ($state.phase -eq 'updater-publishing') {
  $stable = Github 'GET' "$api/repos/$repository/releases/tags/updates-stable"
  $backupName = "latest-backup-$($state.oldStableId).json"
  $current = @($stable.assets | Where-Object { $_.name -ceq 'latest.json' })
  $backup = @($stable.assets | Where-Object { $_.id -eq $state.oldStableId -and $_.name -ceq $backupName })
  if ($current.Count -eq 1 -and $current[0].digest -ceq "sha256:$($state.manifestHash)") {
    $state.phase='updater-published'; Save-State $state
  } else {
    if ($current.Count -eq 1 -and $current[0].id -eq $state.oldStableId -and $backup.Count -eq 0) {
      $null = Github 'PATCH' "$api/repos/$repository/releases/assets/$($state.oldStableId)" @{name=$backupName}
    } elseif ($current.Count -ne 0 -or $backup.Count -ne 1) { throw 'Il manifest online è cambiato durante la release; controlla updates-stable.' }
    $uploaded = $null
    try {
      $uploaded = Upload $stable.id $manifestPath 'latest.json'
      if ($uploaded.digest -cne "sha256:$($state.manifestHash)") { throw 'Checksum manifest non corrispondente.' }
    } catch {
      try { if ($uploaded -and $uploaded.id) { $null = Github 'DELETE' "$api/repos/$repository/releases/assets/$($uploaded.id)" }; $null = Github 'PATCH' "$api/repos/$repository/releases/assets/$($state.oldStableId)" @{name='latest.json'} } catch { Write-Warning "Ripristino automatico non riuscito. Ripristina $backupName come latest.json nella release updates-stable." }
      throw 'Aggiornamento del manifest non riuscito.'
    }
    $state.phase='updater-published'; Save-State $state
  }
}
# END TESTABLE STABLE MANIFEST TRANSITION
# BEGIN TESTABLE DESKTOP-ONLY COMPLETE TRANSITION
if ($state.phase -eq 'updater-published' -and $DesktopOnly) {
  $state.phase='complete'; Save-State $state
  Write-Output "Release $tag pubblicata e updater aggiornato. Il sito non è stato modificato."
}
# END TESTABLE DESKTOP-ONLY COMPLETE TRANSITION
if ($state.phase -eq 'updater-published') {
  Security-Preflight
  Clean $website 'Sito'
  if ((Invoke-Git $website @('rev-parse','HEAD') | Select-Object -First 1).Trim() -cne $state.siteCommit) { throw 'Il codice del sito è cambiato dopo la build.' }
  Push-Location $website
  try { Native 'npm.cmd' @('exec','--offline','--',$wrangler,'pages','deploy',$webDist,'--project-name=virgostars','--branch=main',"--commit-hash=$($state.siteCommit)") } finally { Pop-Location }
  $state.phase='site-published'; Save-State $state
}
if ($state.phase -eq 'site-published') {
  $page=Invoke-WebRequest -Uri ("https://virgostars.pages.dev/desktop/?release=" + [Guid]::NewGuid().ToString('N')) -UseBasicParsing -TimeoutSec 30
  $main=[regex]::Match($page.Content,'main-[A-Z0-9]{8,}\.js').Value
  if (-not $main) { throw 'Deploy eseguito ma bundle pubblico non identificato; riesegui per controllare.' }
  $js=Invoke-WebRequest -Uri "https://virgostars.pages.dev/$main" -UseBasicParsing -TimeoutSec 30
  if (-not $js.Content.Contains($state.assetName)) { throw 'Deploy eseguito ma il sito pubblico non espone ancora il download previsto.' }
  try {
    $custom=Invoke-WebRequest -Uri 'https://virgostars.it/desktop' -UseBasicParsing -TimeoutSec 30
    if (-not $custom.Content.Contains($main)) { Write-Warning 'La pagina /desktop è ancora in cache. Usa https://virgostars.it/desktop/ e verifica la cache del dominio.' }
  } catch { Write-Warning 'Il dominio principale non è ancora verificabile. Controlla https://virgostars.it/desktop/.' }
  $state.phase='complete'; Save-State $state
  Write-Output "Release $tag pubblicata, updater aggiornato e sito verificato: https://virgostars.it/desktop/"
}
if ($state.phase -eq 'complete') {
  $completed = Join-Path $desktop ".local\release-$version-completed.json"
  if (Test-Path -LiteralPath $completed) { throw 'Stato completato già presente: non viene sovrascritto.' }
  Move-Item -LiteralPath $stateFile -Destination $completed
}
