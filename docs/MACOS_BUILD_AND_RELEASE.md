# VirgoStars Desktop — build macOS con un collaboratore

Stato: percorso **preparato nel sorgente, non ancora convalidato su un Mac**. Una GitHub Action è autorizzata esclusivamente per la **build manuale** dei DMG di prova, senza pubblicazioni automatiche. Nessuna notarizzazione o funzionalità macOS è dichiarata convalidata. Le release rimangono una decisione del maintainer.

## Senza un Mac: compilazione con GitHub Actions (solo manuale)

Il workflow [`macOS DMG · manual`](https://github.com/Cesare-ml/virgostars-desktop/actions/workflows/build-macos.yml) usa le VM ufficiali GitHub `macos-15` (Apple Silicon ARM64) e `macos-15-intel` (Intel x64).

1. Nel repository vai a **Actions → macOS DMG · manual**.
2. Seleziona **Run workflow**, branch `main`, e avvia manualmente.
3. Alla conclusione, apri la pagina del run. Nei job `DMG arm64` e `DMG x64` trovi log, eventuali errori, compilazione e verifica SHA-256.
4. Sotto **Artifacts**, scarica gli ZIP `virgostars-macos-arm64-test-…` e `virgostars-macos-x64-test-…`. Ogni ZIP contiene un `.dmg`, `SHA256SUMS.txt` e `build-report.json`.

Il workflow non usa un account Apple Developer e **non possiede segreti di firma**, privilegi di scrittura sui repository, capacità di pubblicare release o trigger su push/PR. Le due build del workflow usano il pacchetto originale `astrological-assets`, fissato a commit e verificato tramite manifest, anziché i segnaposto sintetici. Includono i glifi reali dei dodici segni e dei pianeti, controllati anche nell'output Angular. I dati pubblici DE441 1000–2200 e città sono autenticati con SHA-256. Gli artefatti sono **di prova, non firmati/notarizzati per distribuzione pubblica**, e vengono conservati per 14 giorni. I file `.app` e `.dmg` sono generati dal progetto sul runner ma soltanto il `.dmg`, l'hash e il report vengono caricati come artefatti di workflow.

**Se un job fallisce:** apri il log del passaggio fallito e prepara una issue con link al run, architettura, commit ed errore senza dati sensibili. Un job concluso con successo non sostituisce una prova di avvio/uso del `.dmg` su macOS reale. Per la distribuzione pubblica occorrono verifiche funzionali, diritti dei dataset/immagini, firma Developer ID e notarizzazione separate.

## Destinatario

Una persona con **Mac Apple Silicon oppure Intel x64**, spazio disponibile per Rust/Angular e pacchetti, accesso a Internet e Terminale. Servono, **una volta sola**:

- Xcode Command Line Tools (se assenti, installarle con `xcode-select --install` e concludere l'installazione proposta da macOS);
- Git, Node.js **22.12+ oppure 24.x**, npm, Rust **1.90+** con Cargo, Python 3, curl;
- per pubblicare un DMG senza avvisi Gatekeeper: certificato **Developer ID Application** valido nel Portachiavi del Mac e credenziali Apple per la **notarizzazione**;
- per caricare gli artefatti nel repository: GitHub CLI (`gh`), permesso di scrittura sulla release **esistente** e login già effettuato.

La prima installazione di toolchain e le richieste Apple richiedono intervento umano; **non** è realistico garantire due comandi su un Mac completamente privo di strumenti di sviluppo. La build ordinaria, una volta predisposto il Mac, usa **due comandi**.

## Due comandi per la prima build locale

Da Terminale, in una cartella di lavoro vuota:

```bash
git clone https://github.com/Cesare-ml/virgostars-desktop.git && cd virgostars-desktop
npm run build:mac
```

Il secondo comando:

1. Verifica OS, toolchain e assenza di modifiche locali al codice.
2. Clona automaticamente i checkout fratelli `astrological-charts` e `astrological-functions` ai commit fissati in `scripts/mac/release-common.mjs`. Se esistono già ma hanno revisioni diverse, si ferma senza modificarli.
3. Esegue `npm ci`, build della libreria Charts, test frontend e controlli IPC.
4. Scarica **solo** gli asset delle release GitHub già pubblicate: `world-cities.zip` e il blocco **DE441 1000–2200**; rifiuta dati con SHA-256 o dimensioni differenti, poi li include come risorse locali.
5. Prepara l'inventario delle licenze per la piattaforma nativa, usa l'icona `.icns`, prova a compilare e impacchetta `.app` e `.dmg` tramite Tauri 2.
6. Verifica la struttura DMG, scrive `SHA256SUMS.txt` e `build-report.json` con commit e hash.

I risultati si trovano in `.local/mac/output/<versione>/<architettura>/`. Il progetto tiene dati, cache e risorse scaricate in `.local/`, ignorata da Git.

La compilazione locale predefinita `npm run build:mac` usa ancora **asset sintetici** come diagnostica; la GitHub Action manuale usa invece `npm run build:mac:original` e prepara la grafica autentica verificata. Il controllo `check:public-release` sugli asset originali rimane obbligatorio per la distribuzione pubblica: un DMG di prova con `artwork: original-uncleared` **non è approvato per la pubblicazione come release**. Questo percorso permette comunque di verificare rendering, DE441 e città sul Mac di un collaboratore. In questa prima base non sono compresi USNO ΔT, SPK di Chirone o cataloghi stellari privati: le funzioni che li richiedono possono essere indisponibili, così come i calcoli fuori dalle politiche temporali supportate.

Per eseguire una **build locale con la grafica originale** autorizzata:

```bash
npm run build:mac:original
```

Questo comando aggiunge il checkout pubblico `astrological-assets`, verifica il manifest approvato e la presenza dei glifi nel bundle, e abilita le funzioni di account previste dalla build del proprietario. È anche il comando eseguito dalla GitHub Action manuale. Una build `--original` **non è autorizzata automaticamente alla redistribuzione**: l'approvazione a livello di singolo asset va completata, e la build release impone `npm run check:public-release` nel repository Assets. Non pubblicare una build con questi asset finché il controllo non passa.

## Pubblicazione a tutti: compilazione firmata e notarizzata

Il Mac incaricato della **release ufficiale** deve avere un'identità Apple Developer ID autorizzata dal progetto. Non dare al collaboratore password, certificati privati o chiavi Tauri in chat o nel repository.

Per una release **di anteprima pubblica con soli asset sintetici**, dopo aver impostato privatamente nel Terminale le quattro variabili `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`, `APPLE_ID` e `APPLE_PASSWORD`, eseguire:

```bash
npm run build:mac:release
```

Il comando richiede identità Developer ID, usa la firma/notarizzazione macOS prevista da Tauri e verifica la firma dell'app e il ticket stapled del DMG con `codesign` e `xcrun stapler validate`. Se una fase fallisce, **non viene marcata come pronta per una release**. Il report identifica esplicitamente `synthetic` o `rights-cleared-original`.

Dopo il **collaudo reale su Mac**, la revisione dei diritti di redistribuzione dei pacchetti dati e la creazione da parte del maintainer del tag/release GitHub riferito **esattamente al commit compilato**, un collaboratore con permesso `gh` può usare:

```bash
npm run publish:mac -- vX.Y.Z
```

Questo comando **non crea tag, non apre una nuova release, non pubblica draft e non sovrascrive file**. Rifiuta tag diversi dalla versione, commit diversi da quello firmato, DMG alterati, dati di build di prova, ticket di notarizzazione non valido e release inesistente. Carica soltanto il DMG, checksum e report nella release GitHub esistente. Senza permessi, il collaboratore può consegnare questi tre file al maintainer per l'upload manuale, dopo le stesse verifiche.

**Attenzione alla versione:** la versione in `package.json`, `Cargo.toml` e `tauri.conf.json` deve coincidere e il tag release deve puntare al commit compilato. Non caricare una nuova build 0.0.2 su una vecchia release 0.0.2 che punta a un altro commit. Preparare e convalidare un nuovo numero di versione prima della prima pubblicazione Mac.

Per una release con asset originali, usare `node scripts/mac/build.mjs --original --release`: il controllo pubblicazione del repository Assets deve passare senza eccezioni. Non modificare i manifest/hash per aggirarlo.

## Correzioni macOS del 21 novembre 2026

- **Glifi originali:** le build manuali GitHub Actions per ARM64 e Intel utilizzano ora il pack originale verificato. Un controllo su `dist/desktop/browser/assets/img/simboli-bianchi/` esige 12 segni, pianeti principali, varianti retrograde, nodi e assi; un file mancante o non PNG interrompe il build. `build-report.json` distingue `original-uncleared` da `synthetic` e il controllo CI rifiuta la variante sbagliata.
- **Finestra ridimensionabile:** shell e workspace sono ancorati al viewport nativo di WKWebView; la superficie di lavoro non deve più essere spinta in basso da righe implicite della griglia. Il resize osserva sia shell sia stage, ridimensiona il canvas mantenendo le proporzioni ed evita strisce di sfondo vuote.
- **Regressioni:** i test rilevano una superficie di lavoro spostata in basso o più piccola della finestra; `npm test` viene eseguito prima della compilazione.
- **Verifica visiva richiesta:** sul Mac aprire/chiudere la finestra, espandere/contrarre, ridimensionare ad almeno 850×620 e 1360×880, controllare 12 glifi dei segni, Sole, Luna, pianeti, retrogradi e passaggio tra viste. I test statici e la compilazione CI non sostituiscono questa prova.

## Collaudo minimo obbligatorio su un Mac

Prima di dichiarare la release riuscita: installare il DMG e avviare l'app **fuori dal checkout** e senza variabili d'ambiente; verificare vista del cielo attuale con posizioni reali, grafico leggibile e WebGL, scelta di una città offline, ricerca/salvataggio/modifica di un tema nell'archivio cifrato, chiusura e riavvio, foto private se la funzione è inclusa, controllo dati DE441 e finestra Account (se compilata). Ripetere almeno su Apple Silicon; per Intel, compilare e testare un altro DMG su Intel. Non chiamare `universal` due pacchetti di architetture diverse.

Testare una DMG ricevuta tramite download da GitHub, non solo il file locale. Firma Apple e notarizzazione non sostituiscono il collaudo funzionale né un audit privacy.

## Limitazioni deliberate

- **Nessuna compilazione Mac verificata** in questo cambio: non è disponibile un host macOS in questa sessione.
- Gli asset originali nel repository Assets sono pubblici, ma non tutti hanno completato la verifica di redistribuzione; una build con immagini originali è privata finché non approvata.
- La build Mac è **nativa** all'architettura del Mac che compila: per ARM e Intel occorrono due build, o un futuro lavoro dedicato per un'app universale.
- Il meccanismo di updater Windows non produce qui un archivio updater macOS `.app.tar.gz` né manifest multiarchitettura firmati. L'aggiornamento automatico su Mac richiede un passaggio successivo; la distribuzione iniziale è tramite DMG.
- Test CLI, checksum, catalogo città e DE441 non implicano che tutte le funzioni astrologiche siano collaudate su macOS.
- Una release GitHub pubblica non sostituisce la verifica dei diritti di redistribuzione della banca dati città e degli altri contenuti inclusi.

Riferimenti: [Tauri macOS DMG](https://v2.tauri.app/distribute/dmg/), [Tauri bundle app](https://v2.tauri.app/distribute/macos-application-bundle/), [Tauri firma e notarizzazione](https://v2.tauri.app/distribute/sign/macos/).
