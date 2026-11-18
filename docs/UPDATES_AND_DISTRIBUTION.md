# Aggiornamenti e distribuzione

Stato: **prototipo in revisione**. Questa modifica non pubblica release e non dimostra ancora un aggiornamento installato su Windows. La versione iniziale 0.0.1 non ha un updater: 0.0.2 va installata manualmente. L'updater non funziona finché non viene incorporata una chiave pubblica e non esistono endpoint accessibili.

L'host usa `tauri-plugin-updater` 2.14.1 e richiede firma e versione firmata (`requireSignedVersion`). I due endpoint sono fissi e puntano a `latest.json` nelle release GitHub con tag `updates-stable` e `updates-beta`. L'utente sceglie il canale; stable rifiuta prerelease e Tauri accetta solo versioni superiori a quella installata. Il controllo di avvio è asincrono; solo l'azione esplicita Aggiorna scarica e installa. Gli errori non interrompono l'uso offline. Il download viene verificato dal plugin prima dell'installazione. Il programma di installazione NSIS di Tauri riavvia per impostazione predefinita.

La chiave pubblica viene incorporata in compilazione tramite `VIRGOSTARS_UPDATER_PUBLIC_KEY`. Senza di essa il bridge restituisce `not_configured`; la configurazione predefinita non contiene chiavi né endpoint. Il frontend non può scegliere un URL, una chiave o consentire downgrade. Nessun permesso del plugin è esposto direttamente alla WebView: l'IPC ha due comandi dedicati. Le informazioni della release sono mostrate come testo.

Prima del passaggio a NSIS, il bridge attende le operazioni sull'archivio e crea una copia verificata dell'archivio cifrato e delle fotografie cifrate in `update-backups` sotto la cartella dati locale. Se la copia fallisce, l'installazione è rifiutata. Le chiavi restano nel gestore credenziali del sistema e non sono esportate. Il backup è locale e non è una copia di sicurezza su un altro dispositivo. L'updater non modifica lo schema né esegue migrazioni o ripristini automatici. Una futura migrazione deve prima definire e verificare backup, compatibilità e ripristino separatamente.

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

## Collaudo 0.0.2 → 0.0.3, non ancora eseguito

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

Verificare: versione corrente senza aggiornamento; notifica e note di 0.0.3; percentuale durante il download; interruzione di rete; firma errata e versione firmata alterata, entrambe rifiutate; consenso e riavvio; contenuto dell'archivio e foto dopo il riavvio; impostazioni, catalogo città ed effemeridi; installazione di 0.0.1 → 0.0.2; passaggio beta/stable senza downgrade; installer interrotto e recupero manuale da una copia verificata. Non dichiarare superati questi casi senza osservarli.

## Limiti aperti prima della release

- Il trasferimento e l'installazione reali, incluse firme valide/non valide, versioni firmate e riavvio NSIS, non sono stati collaudati end-to-end.
- La compatibilità dei vecchi installer e la conservazione di eventuali cataloghi o DE441 inclusi nelle risorse di installazione richiedono una prova con i pacchetti reali. Non assumere che un aggiornamento dei binari conservi risorse distribuite separatamente sotto la cartella di installazione.
- Il download è limitato a 512 MiB prima della verifica Tauri e resta in memoria; installer più grandi sono rifiutati. Dimensione e distribuzione separata di eventuali dataset molto grandi richiedono una prova reale.
- Non esiste ancora ripristino automatico verificato di backup o migrazione di schema. Non spedire una migrazione finché non è stata progettata e collaudata.
- Non è stata verificata la disponibilità pubblica degli endpoint GitHub di canale; l'aggiornamento richiede HTTPS accessibile senza segreti incorporati nel client.
