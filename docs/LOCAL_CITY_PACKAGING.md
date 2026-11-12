# Catalogo offline di città e stati

**Stato: prototipo locale.** Il convertitore importa i CSV forniti dal proprietario in SQLite/FTS5, senza contattare PostgreSQL o servizi remoti. La ricerca nativa e il selettore in Parametri sono sperimentali. La scelta è temporanea e non modifica il grafico dimostrativo.

## Compilare con il catalogo completo

Il repository è privato: serve un account GitHub con accesso al repository, anche per scaricare la release privata del catalogo. Installare [GitHub CLI](https://cli.github.com/), autenticarsi con `gh auth login` e seguire i prerequisiti per Node, Rust, WebView2 e il repository `astrological-charts` in [CONTRIBUTING](CONTRIBUTING.md). Il pacchetto è fissato alla release `places-20261112-v2`; lo script confronta SHA-256 dell'archivio e del database con valori presenti nel codice, rifiuta file inattesi e non sovrascrive un catalogo diverso.

Su Windows, dopo avere configurato e compilato la libreria Charts e installato le dipendenze npm:

```powershell
npm run tauri:build:places:windows
```

Il comando scarica il catalogo autorizzato, genera l'overlay, compila il frontend e crea gli installer. Il database si conserva in `.local/places` e viene incluso come risorsa offline; la normale `npm run tauri:build` resta la build sintetica senza catalogo. Su macOS, con gli stessi prerequisiti della piattaforma, eseguire `python3 scripts/places/fetch_catalog.py`, `python3 scripts/places/prepare_tauri_bundle.py`, `npm run build:ui`, `npm run prepare:icon` e `npx tauri build --config .local/places/tauri-places.conf.json`; il percorso macOS non è stato verificato. L’accesso alla release privata richiede i permessi del repository e non equivale a disponibilità pubblica.

## Conversione degli export originali

Gli export ricevuti hanno rispettivamente dieci colonne `id,nome,nome_it,lat,lng,pop,stato_id,regione,tz,tz_offs` e quattro colonne `id,nome,nome_it,iso2`, senza intestazione. Lo schema proviene dalle tabelle `citta` e `stati`. `--source-export` abilita esplicitamente questo formato; senza l'opzione restano supportati i CSV documentati dall'interfaccia del convertitore. I nomi italiani degli stati sono conservati in SQLite; il contratto attuale mostra il nome originale dello stato.

```powershell
py -3 scripts/places/build_catalog.py build --csv <citta.csv> --countries-csv <stati.csv> --source-export --out .local/places/world-cities.sqlite --expected-rows 1951599
py -3 scripts/places/prepare_tauri_bundle.py
```

L'importazione valida ID, coordinate, conteggio e copertura degli stati; crea un indice FTS5 e un manifest SHA-256. Non sovrascrive un catalogo esistente. L'overlay generato in `.local/places/tauri-places.conf.json` permette una build Tauri con il database come risorsa, ad esempio dopo la build dell'interfaccia e la preparazione dell'icona:

```powershell
npx tauri build --config .local/places/tauri-places.conf.json
```

Il normale prototipo senza overlay non contiene il database. `.local/` è esclusa da Git: non aggiungere gli export o il catalogo generato alla cronologia. Prima della distribuzione verificare diritti, attribuzioni, firma e installazione su Windows. Il campo `tz_offs` non fornisce un offset storico attendibile: conservare il fuso IANA e risolvere la data civile con regole storiche verificate.

Vedere [ricerca nativa](NATIVE_OFFLINE_PLACES.md) e [associazione stati](OWNED_COUNTRY_LOOKUP.md).

In questa verifica locale il catalogo completo è stato creato in `.local/places/world-cities.sqlite` e copiato con verifica SHA-256 in `src-tauri/target/debug/places/world-cities.sqlite` accanto all’eseguibile di prova. La disponibilità della risorsa in una build di sviluppo non prova il funzionamento dell’installer né il comportamento WebView2.
