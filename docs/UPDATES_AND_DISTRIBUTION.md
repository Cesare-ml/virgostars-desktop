# Aggiornamenti e distribuzione

## Comando guidato di release: implementazione locale, pubblicazione non collaudata

Su richiesta del proprietario, `npm run release:publish -- -DesktopOnly`
pubblica la release Desktop e aggiorna `updates-stable` senza leggere,
modificare o pubblicare il sito. La modalità è registrata nello stato di
avanzamento e deve essere ripetuta quando si riprende una release interrotta.
`-PrepareOnly` si ferma prima della firma e della pubblicazione: prepara la
versione e il branch remoto, compila il renderer e scrive le note, così la
firma può essere eseguita in un PowerShell interattivo. La modalità completa
continua ad applicare il proprio preflight del sito.

Da Windows, nel checkout Desktop:

```powershell
npm run release:check
npm run release:publish
```

Il primo comando controlla soltanto prerequisiti e accessi. Il secondo prepara
la successiva versione patch, compila il renderer e l'installer con la password
Tauri richiesta nel terminale, genera firma e checksum, prepara la pagina web,
crea la release GitHub, aggiorna `updates-stable` e pubblica Pages. La password
e le credenziali GitHub restano nei processi che le usano. Usa Git Credential
Manager e Wrangler 4.165.0 già autenticati; lo script non installa software.

Richiede i checkout fratelli `virgo-stars` e `astrological-charts`, puliti e con
il commit del renderer già disponibile su GitHub. Il checkout Desktop deve
essere pulito: le modifiche esistenti non vengono aggiunte automaticamente.
Lo script crea un commit di versione Desktop e lo invia su un nuovo branch
`releases/v<versione>`; crea anche un commit locale nel sito per il manifest.
Quel commit del sito non viene inviato automaticamente al suo repository.
Se la versione è già usata, lo script si ferma senza sovrascriverla.

La build del sito mantiene JS e CSS con hash della build precedente. Gli asset
GitHub sono confrontati con gli SHA-256 locali prima di aggiornare il canale
stable; il vecchio manifest viene rinominato e conservato per recupero. Lo
stato delle fasi è sotto `.local/` e permette di riprendere un'interruzione
eseguendo nuovamente il comando. Le note predefinite sono generiche: per
fornirle esplicitamente usare
`npm run release:publish -- -Notes "Descrizione della release"`.

**Blocco attuale:** il controllo read-only rileva file sensibili ancora
tracciati nel repository del sito. Le sue regole in `docs/SECURITY.md` e
`docs/deployment/PRODUCTION_CHANGE_SAFETY.md` richiedono la bonifica prima di
nuove pubblicazioni; lo script si ferma. L'assenza dei file tracciati non prova
da sola la rotazione delle credenziali o la bonifica della cronologia. La
pubblicazione completa non è stata eseguita né collaudata end-to-end.

## Correzione locale del manifest 0.0.4

GitHub ha pubblicato l'installer 0.0.4 sostituendo gli spazi del nome con punti,
mentre il manifest iniziale conteneva il nome locale con spazi. Il controllo
della versione riusciva, ma il successivo URL di download non esisteva. Il
manifest corretto mantiene la stessa versione, la stessa firma e gli stessi
byte dell'installer e usa il nome dell'asset effettivamente pubblicato. Gli
utenti della 0.0.3 possono riprovare dopo la sostituzione di `latest.json` nella
release `updates-stable`; questa correzione non modifica la firma dell'update.
Per i manifest futuri, lo script usa nel URL il nome con i punti e conserva
immutato il file locale da firmare. Verificare sempre il nome effettivo degli
asset nella release prima di pubblicare il manifest.

L'avviso di aggiornamento è un pulsante compatto e il download mostra una
scheda con avanzamento. Queste modifiche dell'interfaccia sono locali e non
sono presenti nelle versioni già pubblicate.

Stato: **prototipo in revisione**. Un aggiornamento 0.0.2 → 0.0.3 è stato collaudato su Windows con installer, dati e chiavi sintetici isolati e un server HTTPS locale; non è una verifica delle release pubbliche né dei dati reali. La versione iniziale 0.0.1 non ha un updater: 0.0.2 va installata manualmente. L'updater di distribuzione non funziona finché non viene incorporata una chiave pubblica e non esistono endpoint accessibili.

L'host usa `tauri-plugin-updater` 2.14.1 e richiede firma e versione firmata (`requireSignedVersion`). I due endpoint sono fissi e puntano a `latest.json` nelle release GitHub con tag `updates-stable` e `updates-beta`. L'utente sceglie il canale; stable rifiuta prerelease e Tauri accetta solo versioni superiori a quella installata. Il controllo di avvio è asincrono; solo l'azione esplicita Aggiorna scarica e installa. Gli errori non interrompono l'uso offline. Il download viene verificato dal plugin prima dell'installazione. Il programma di installazione NSIS di Tauri riavvia per impostazione predefinita.

La chiave pubblica viene incorporata in compilazione tramite `VIRGOSTARS_UPDATER_PUBLIC_KEY`. Senza di essa il bridge restituisce `not_configured`; la configurazione predefinita non contiene chiavi né endpoint. Il frontend non può scegliere un URL, una chiave o consentire downgrade. Nessun permesso del plugin è esposto direttamente alla WebView: l'IPC ha due comandi dedicati. Le informazioni della release sono mostrate come testo.

Prima del passaggio a NSIS, il bridge attende le operazioni sull'archivio e crea una copia verificata dell'archivio cifrato, delle fotografie cifrate, dell'eventuale `ephemeris.json` e delle risorse `places` ed `ephemeris` presenti nell'installazione. Ogni file viene copiato e confrontato con l'originale tramite SHA-256; un manifest descrive la copia. Una cartella `.pending-*` non è un backup completato: viene rinominata `before-*` solo al termine. Se la copia fallisce (per esempio spazio insufficiente o collegamenti nelle risorse), l'installazione è rifiutata. Le chiavi restano nel gestore credenziali del sistema e non sono esportate. Il backup è locale, può richiedere molto spazio, e non sostituisce una copia su un altro dispositivo. `ephemeris.json` può contenere percorsi locali e va trattato come dato personale. I file configurati in percorsi esterni all'installazione non vengono copiati né modificati dall'updater. Preferenze WebView, credenziali e altri dati locali restano nelle rispettive sedi. L'updater non cambia schema né esegue migrazioni.

Se dopo un aggiornamento non esiste più il catalogo città o una risorsa predefinita delle effemeridi, il programma prova a usare una copia integra da un backup completato. Le posizioni esplicitamente configurate mantengono la precedenza. Il ripristino di archivio e foto è un'operazione manuale distinta, descritta sotto; nessuna chiave viene ripristinata o esportata.

## Ripristino locale, con applicazione chiusa

La copia va usata sullo stesso profilo Windows e con la stessa chiave dell'archivio nel gestore credenziali: la sola copia cifrata non basta se la chiave è perduta. Chiudere VirgoStars e individuare la cartella dati dell'installazione e il nome `before-*` in `update-backups`. Dal checkout, con Node installato:

```powershell
$data = Join-Path $env:LOCALAPPDATA 'it.virgostars.desktop.rendererlab' # verificare l'identificativo della propria installazione
Get-ChildItem -LiteralPath (Join-Path $data 'update-backups') -Directory -Filter 'before-*'
$snapshot = 'before-SOSTITUIRE-CON-IL-NOME-EFFETTIVO'
node .\scripts\updates\restore-backup.mjs --data-dir $data --snapshot $snapshot
node .\scripts\updates\restore-backup.mjs --data-dir $data --snapshot $snapshot --apply
```

Il primo comando verifica tutte le impronte senza modificare dati. Il secondo ricontrolla le impronte, richiede che l'app non sia in esecuzione, conserva i file attuali in `restore-work-*` e ripristina archivio, foto e configurazione presenti nella copia. Non elimina foto aggiunte dopo il backup. Le risorse restano nel backup e sono utilizzabili come fallback; il comando non scrive nella cartella d'installazione. Se la procedura viene interrotta, lasciare l'app chiusa ed eseguire `node .\scripts\updates\restore-backup.mjs --data-dir $data --rollback`; l'archivio resta bloccato finché il ripristino interrotto non è stato annullato. Non cancellare manualmente `restore-in-progress.json`. I vecchi backup senza manifest non sono accettati da questo strumento.

## Chiavi e firma

Generare le chiavi **personalmente**, fuori da tutti i checkout, proteggendo la chiave privata con password e salvandone una copia offline sicura. Non inserirla in Git, issue, messaggi o release. Non usare `--force` su una chiave esistente. Per esempio, in PowerShell dalla radice Desktop:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\VirgoStarsSigning" | Out-Null
npm ci --ignore-scripts
npx tauri signer generate -w "$env:USERPROFILE\VirgoStarsSigning\updater.key"
```

La chiave pubblica (`updater.key.pub`) può essere distribuita. La firma Tauri degli aggiornamenti non è la firma Authenticode dell'installer Windows: certificato, protezione della chiave e firma Authenticode sono una procedura distinta.

## Preparazione manuale

Preparare prima i pacchetti autorizzati, il catalogo città e la configurazione delle effemeridi seguendo la documentazione di build esistente. Non caricare pacchetti privati o dati utente nelle release. Dalla radice del checkout:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$env:USERPROFILE\VirgoStarsSigning\updater.key"
$updatePassword = Read-Host 'Password chiave updater' -AsSecureString
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.Net.NetworkCredential]::new('', $updatePassword).Password
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\updates\build-signed-installer.ps1 -PublicKeyFile "$env:USERPROFILE\VirgoStarsSigning\updater.key.pub"
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PATH
Remove-Variable updatePassword
```

Il comando produce l'installer NSIS e il file `.sig` con firma della versione, senza pubblicare. La password resta temporaneamente nell'ambiente del processo: usare un terminale fidato e chiuderlo dopo l'operazione. Creare manualmente un file UTF-8 `release-notes.txt` senza dati privati, quindi sostituire i percorsi con quelli effettivamente generati:

```powershell
node .\scripts\updates\prepare-manifest.mjs --channel stable --installer '.\src-tauri\target\release\bundle\nsis\NOME_INSTALLER.exe' --signature '.\src-tauri\target\release\bundle\nsis\NOME_INSTALLER.exe.sig' --notes '.\release-notes.txt' --output '.\latest.json'
```

Lo script controlla la presenza della versione nel commento firmato, ma **non verifica crittograficamente** il file: questa verifica resta compito dell'updater. Caricare manualmente installer e `.sig` nella release immutabile `v0.0.2`, quindi `latest.json` nella release di canale `updates-stable` oppure `updates-beta`. Gli asset e il manifest devono essere pubblicamente scaricabili senza credenziali: le release di un repository privato non soddisfano questa condizione. Nessuna modifica alla visibilità del repository viene effettuata da questi script.

## Collaudo 0.0.2 → 0.0.3

Il 18 novembre 2026 è stato eseguito un collaudo Windows 11 su un'installazione NSIS con identificativo e cartella separati, chiave di firma temporanea e server HTTPS `localhost`. La feature `updater-loopback-test` è compilabile solo in debug, impone un identificativo di prova e usa una chiave fittizia per l'archivio: **non distribuire questi binari**. Gli installer avevano versioni Tauri 0.0.2 e 0.0.3 (la versione Cargo del sorgente di test è rimasta 0.0.2). Sono stati osservati: assenza di aggiornamenti, errore di connessione, firma errata, download interrotto, avanzamento fino al 100%, installazione e riavvio alla 0.0.3; il tema e la foto sintetici erano leggibili dopo il riavvio, un valore di localStorage è rimasto presente e le impronte di archivio, foto, catalogo ed effemeridi sintetici coincidevano con il manifest. Su 0.0.3 entrambi i canali di prova hanno rifiutato la versione 0.0.2; un pacchetto 0.0.3 annunciato come 0.0.4 è stato rifiutato per versione firmata non corrispondente. La verifica dei canali reali GitHub e delle credenziali Windows reali resta separata.

È stato inoltre verificato il fallback al catalogo sintetico salvato nel backup quando il file installato manca; il file sintetico non è un database città funzionante.

### Ripetere la prova senza pubblicare

Servono Windows 11, Node, Rust/Tauri, NSIS, OpenSSL nel `PATH`, le dipendenze del progetto e i repository fratelli previsti dalla guida di build. La porta 47831 deve essere libera. Da un checkout dedicato e dal suo percorso radice:

```powershell
$test = Join-Path $env:TEMP ('virgostars-updater-test-' + [guid]::NewGuid().ToString('N'))
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\updates\prepare-loopback-test.ps1 -TestRoot $test
$env:VIRGOSTARS_ACCEPTANCE_ROOT = $test
$server = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'scripts/updates/loopback-test-server.mjs' -WindowStyle Hidden -PassThru
$install = Join-Path $test 'install'
if (Test-Path -LiteralPath $install) { throw 'Cartella di prova già esistente.' }
$setup = Start-Process -FilePath (Join-Path $test '002.exe') -ArgumentList @('/S', "/D=$install") -WindowStyle Hidden -Wait -PassThru
if ($setup.ExitCode -ne 0) { throw 'Installazione di prova non riuscita.' }
& (Join-Path $install 'virgostars-desktop-spike.exe')
```

Il comando finale apre l'app di prova; eseguire i successivi comandi in un secondo terminale PowerShell, con `$test` impostato allo stesso percorso. In `Impostazioni → Aggiornamenti`, premere «Verifica aggiornamenti» dopo ogni cambio di modalità. `same` mostra nessun aggiornamento, `offline` simula assenza di rete, `invalid` una firma errata, `interrupt` un download interrotto e `good` l'aggiornamento firmato. Salvare soltanto un tema e una foto fittizi, annotare le impronte locali, impostare `good` e premere «Aggiorna»: verificare progresso, riavvio e dati. Dopo il riavvio, `same` verifica il mancato downgrade e `version` annuncia 0.0.4 con una firma valida per 0.0.3, che deve essere respinta.

```powershell
[IO.File]::WriteAllText((Join-Path $test 'mode.txt'), 'good')
# Al termine, nel primo terminale, dopo aver chiuso l'app di prova:
Stop-Process -Id $server.Id
```

In un worktree annidato, il progetto può non trovare i repository fratelli durante la preparazione del frontend: se il frontend sintetico è già stato costruito e verificato, lo switch `-UseExistingFrontend` riutilizza `dist/desktop/browser` invece di ricostruirlo. Le chiavi temporanee e il certificato di prova restano nella cartella di prova; eliminarli secondo le proprie procedure dopo aver terminato, senza riusarli per release. Il server di prova non pubblica alcun file.

La procedura seguente descrive un'ulteriore prova dei pacchetti di distribuzione in un ambiente autorizzato; non è stata eseguita con release pubbliche.

Usare una VM Windows 11 e un profilo **di prova**, mai l'archivio personale. Installare 0.0.2 manualmente; salvare temi e foto sintetici e annotare versione, impostazioni e impronte dei file. Preparare su un checkout separato la versione 0.0.3 aggiornando insieme `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` e `src-tauri/tauri.conf.json`; eseguire `npm run verify:version`, poi il build firmato e il manifest come sopra. Pubblicare gli artefatti soltanto in un ambiente di test autorizzato, verificando che l'endpoint integrato sia effettivamente raggiungibile dal profilo di test.

Nel checkout di test dedicato, partendo da 0.0.2, questi comandi preparano la versione 0.0.3 senza creare tag o pubblicare:

```powershell
npm version 0.0.3 --no-git-tag-version --ignore-scripts
node -e 'const fs=require("fs");for(const f of ["src-tauri/Cargo.toml","src-tauri/tauri.conf.json"]){const s=fs.readFileSync(f,"utf8");if(!s.includes("0.0.2"))throw Error("Versione attesa assente");fs.writeFileSync(f,s.replace("0.0.2","0.0.3"));}'
Push-Location src-tauri
cargo check --offline
Pop-Location
npm run verify:version
```

Eseguire quindi lo script `build-signed-installer.ps1` precedente con la stessa chiave di test e generare `latest.json` usando i percorsi dell'installer 0.0.3 e della sua firma. Non riutilizzare una chiave di produzione per una VM usa e getta.

Per isolare il controllo dai canali Stable e Beta, entrambe le build della prova devono essere create con `-TestChannel` e con la stessa **chiave di test separata**. Il client di prova usa soltanto il tag `updates-testing` e mostra `(test)` accanto alla versione; non distribuire mai queste build come release normali. Il manifest si prepara con `--channel testing` e punta alla release `test-v0.0.3`. Solo dopo autorizzazione alla pubblicazione, rendere disponibili installer e firma in quella release di prova e il manifest nella release `updates-testing`: questi tag non modificano i manifest `updates-stable` o `updates-beta`. I file non vengono pubblicati automaticamente.

Con chiave di test già generata e percorsi di build privati predisposti, per ciascuna versione usare il comando sotto; dopo il build di 0.0.3, il blocco individua un solo installer e prepara il manifest senza pubblicarlo:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$env:USERPROFILE\VirgoStarsSigning\updater-test.key"
$updatePassword = Read-Host 'Password chiave di test' -AsSecureString
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.Net.NetworkCredential]::new('', $updatePassword).Password
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\updates\build-signed-installer.ps1 -PublicKeyFile "$env:USERPROFILE\VirgoStarsSigning\updater-test.key.pub" -TestChannel
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PATH
Remove-Variable updatePassword
$testInstallers = @(Get-ChildItem .\src-tauri\target\release\bundle\nsis\ -Filter '*0.0.3*x64-setup.exe')
if ($testInstallers.Count -ne 1) { throw 'Serve esattamente un installer di prova 0.0.3.' }
if (Test-Path .\release-notes-test.txt) { throw 'Il file release-notes-test.txt esiste già.' }
Set-Content -Encoding utf8 .\release-notes-test.txt 'Aggiornamento di prova 0.0.3'
node .\scripts\updates\prepare-manifest.mjs --channel testing --installer $testInstallers[0].FullName --signature ($testInstallers[0].FullName + '.sig') --notes .\release-notes-test.txt --output .\latest-testing.json
```

Verificare: versione corrente senza aggiornamento; notifica e note di 0.0.3; percentuale durante il download; interruzione di rete; firma errata e versione firmata alterata, entrambe rifiutate; consenso e riavvio; contenuto dell'archivio e foto dopo il riavvio; impostazioni, catalogo città ed effemeridi; installazione di 0.0.1 → 0.0.2; passaggio beta/stable senza downgrade; installer interrotto e recupero manuale da una copia verificata. Non dichiarare superati questi casi senza osservarli.

## Limiti aperti prima della release

- La compatibilità della release esistente 0.0.1 e la conservazione di cataloghi e DE441 reali richiedono ancora una prova con i pacchetti di distribuzione. Il collaudo locale ha usato soltanto file sintetici.
- Il download è limitato a 512 MiB prima della verifica Tauri e resta in memoria; installer più grandi sono rifiutati. Dimensione e distribuzione separata di eventuali dataset molto grandi richiedono una prova reale.
- Il ripristino manuale e il rollback di una sua interruzione sono coperti da test automatici sintetici; non è stato collaudato un ripristino dell'archivio personale né una migrazione di schema. Non spedire una migrazione finché non è stata progettata e collaudata.
- Non è stata verificata la disponibilità pubblica degli endpoint GitHub di canale; l'aggiornamento richiede HTTPS accessibile senza segreti incorporati nel client.
- Il canale GitHub `updates-testing` è predisposto ma non è stato pubblicato né collaudato end-to-end; richiede una VM, chiave e artefatti di test separati.
