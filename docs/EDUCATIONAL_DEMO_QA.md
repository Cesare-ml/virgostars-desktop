# Educational demo QA — 14 scenari VirgoStars Desktop

**Stato:** protocollo di verifica locale sperimentale, non certificazione di release. **Data:** 20 novembre 2026. **Nessun invio email / outreach autorizzato.**

Questo protocollo traduce in prove eseguibili la matrice delle 14 esigenze didattiche raccolte nella [documentazione globale del sito](https://github.com/Cesare-ml/virgo-stars/blob/docs/astrology-education-expansion-2026-11-19/docs/product/GLOBAL_ECOSYSTEM_PARTNER_QUALITY_GATE_2026-11-20.md). Non importa nominativi o altri dati del CRM privato.

**Politica di esecuzione Rust:** i comandi Cargo usano `test --offline --locked` e `CARGO_NET_OFFLINE=true`. Se dipendenze e lockfile non sono pronti, lo stato resta `BLOCKED_ENV` invece di tentare un download automatico. I test JavaScript sono eseguiti localmente come subprocessi; **il runner non può garantire che ogni test preesistente non acceda alla rete**. Per isolamento rigoroso, eseguire i checkout in un ambiente con rete disabilitata. Non utilizzare dati personali.

## Prerequisiti

- Node.js 22.12+ o 24 (compatibile con il progetto), npm. Per i test Rust: Cargo/rustc compatibili con il repository Ephemeris.
- Repository locali **fratelli** (non clonarli automaticamente tramite il runner): `virgostars-desktop`, `astrological-functions`, `astrological-charts`, `virgostars-ephemeris`. Per Charts e Desktop preparare le dipendenze e, dove richiesto, il build locale come nelle rispettive README.
- **Dati fittizi** per contratti e UI. DE441 autentica, riferimenti di confronto, effemeridi stellarI e runtime grafico/native sono requisiti esterni per la convalida finale; non sono distribuiti né scaricati dallo script.

## Comandi

Dal repository **VirgoStars Desktop**:

```bash
npm run qa:education-demo
npm run qa:education-demo -- --run --only QA-02,QA-03 --out .local/education-demo-qa.json
```

Il primo comando è **dry-run** e verifica solo presenza e struttura dei repository. Il secondo esegue i test esistenti per i due scenari selezionati, poi salva un report JSON sotto `.local/` (ignorata da Git). Tutti i 14 scenari possono essere selezionati omettendo `--only`, ma **QA-11 rimane esplicitamente bloccato** finché non saranno convalidati algoritmi e test specifici per profezioni e firdarie.

Opzioni: `--dry-run` (default), `--run`, `--only QA-01,QA-06`, `--root PERCORSO_DESKTOP`, `--out FILE_JSON`, `--help`. Un `--only` mancante, vuoto o con ID inesistente è rifiutato; non produce un finto successo a zero test.

## Interpretazione dello stato

| Stato | Significato |
|---|---|
| `NOT_RUN` | Non richiesto l'avvio dei test: solo preflight |
| `BLOCKED_ENV` | Checkout, file, dipendenza o eseguibile richiesto assente |
| `BLOCKED_CAPABILITY` | Mancano funzioni/metodi validati per lo scenario |
| `FAILED_AUTOMATED` | Test fallito, terminato in errore o senza sufficiente prova di esecuzione |
| `PASS_AUTOMATED` | **Singolo gruppo di test** completato con evidenza positiva |
| `AUTOMATED_PARTIAL_MANUAL_REQUIRED` | I test selezionati sono passati, ma rimangono gate end-to-end/manuali |

Codice d'uscita: **0** per dry-run o soli test automatici riusciti, **1** per test fallito/insufficiente, **2** per blocchi ambientali o capability non presenti nel run. Il valore zero **non significa mai** demo completa o pronta per le scuole.

La procedura richiede un conteggio positivo di test effettivamente eseguiti e controlla i riepiloghi TAP o Cargo. Non considera un successo un file Node che termina con codice 0 senza registrare test, né un file con tutte le prove saltate. Per ridurre il rischio di diffondere dati riservati, il JSON **non** include gli stdout/stderr grezzi dei test.

## Copertura dei 14 scenari

| ID | Tema | Percorso automatico (sintesi) | Gate ancora necessario |
|---|---|---|---|
| QA-01 | Tema, assi, case e aspetti | Rust angoli/pianeti, Functions house-set, Charts assi, Desktop contract | DE441/Swiss indipendenti; grafico nativo |
| QA-02 | Oraria e ore planetarie | Functions Regiomontanus, planetary hours, **solar-event adapter**, lots, Desktop hours | Alba reale/settori; applicazione oraria |
| QA-03 | Stelle fisse, lotti e aspetti | Rust fixed-star provider, lots, Desktop star-link | Catalogo reale, epoca, precisione |
| QA-04 | Sinastria, transiti e progressioni | Charts endpoints, Desktop sync, Functions aspect-trend | Carte vere e progressioni **non presunte** |
| QA-05 | Affollamento del grafico | Rust planets, Charts layout/assi, Desktop contract | Screenshot/manuale grafico con posizioni reali |
| QA-06 | Rivoluzioni e punti medi | Functions midpoint, Desktop returns contract | Ritorni astronomici e calcoli esatti indipendenti |
| QA-07 | Comparazione didattica | Charts skin e renderer geometry | Confronto manuale a parametri identici |
| QA-08 | Località, archivio, privacy | Desktop offline search, archivio, chart archive | Windows native, cifratura effettiva, foto locali |
| QA-09 | Elementi, aspetti e assi | Desktop elements, Charts markers | Accessibilità, assets ufficiali, interazione |
| QA-10 | Ritorni, transiti esatti | Desktop returns/aspects, Functions aspect trend | Valori astronomici reali, timing indipendente |
| QA-11 | Profezioni e firdarie | **NESSUN test sufficiente** | Algoritmi, fixture e supporto nella release |
| QA-12 | Oraria Cina, fuso e calendario | Rust calendar, Desktop civil-time / city clock | Verifica Asia/Shanghai, lingua ZH |
| QA-13 | Cielo attuale in tempo reale | Desktop clock/live, Charts defaults | WebView2, cambio città, assets originali |
| QA-14 | Case, aspetti, materiali didattici | Functions house-set, Charts markers, Desktop time | Calendario scuola e metodo effettivamente supportati |

**I file di test collegati servono come regressioni parziali**, non come prova matematica globale, integrazione completa fra quattro repository o release distribuita. Gli scenari possono usare input sintetici come una data UTC fissa, Roma o un altro luogo con coordinate esplicite; **nessun dato personale reale** è necessario.

**Nota QA-02:** il runner ora esegue anche `test/planetary-hours-solar-adapter.test.mjs` per verificare il passaggio di dati di alba e tramonto al calendario. La regressione dell'adattatore usa eventi **forniti dal chiamante**, non dimostra il calcolo astronomico o la correttezza dei dati di alba reali. In una verifica isolata del 20/11/2026, gli **11 casi del modulo adapter sono risultati superati**, ma occorre ripetere la suite nei checkout completi.

## Evidenze disponibili alla stesura

**Integrità della mappatura (20/11/2026):** i 14 scenari dichiarano **42 riferimenti** a **32 file di test distinti** sui quattro repository; la presenza delle 32 destinazioni nei branch `main` è stata controllata tramite directory GitHub. Il controllo dei percorsi **non** equivale all'esecuzione o a una verifica delle dipendenze. Tutti i 14 scenari end-to-end rimangono non certificati.



Sono state eseguite verifiche isolate del codice JavaScript letto dai repository: **11/11** test di ore planetarie, **11/11** test dell'adattatore degli eventi solari (con clone equivalente per soli oggetti dati nell'ambiente isolato), **31/31** test di andamento degli aspetti e **5/5** test della precessione IAU 2006: **58/58 test isolati**, distinti dall'esecuzione Node/Cargo standard. Questi controlli non equivalgono a `npm test` o `cargo test` nei checkout né convalidano pipeline native. L'esecutore ha **11 test di regressione già eseguiti su fixture locali**; un **dodicesimo test** controlla il mapping dell'adattatore ed è stato aggiunto al branch, ma non eseguito come suite nativa in questa sessione. La logica del runner aggiornata è stata inoltre provata con subprocessi simulati (successo parziale, test vuoti, skipped, cache Cargo assente, QA-11 bloccato).

Non risultano qui eseguiti **i 14 scenari Desktop end-to-end** e non sono state scaricate/installate dipendenze o DE441. Qualsiasi report futuro deve includere commit SHA, comando realmente lanciato, OS, versioni strumenti, eventuali fixture e blocchi. Il gate di release resta **non superato** fino a risultati native/visual/manuali ripetibili.

## Separazione da partnership

Le 40 scuole prioritizzate e i 1.200 prospect censiti in documentazione non sono soggetti consenzienti: un test tecnico positivo non abilita contatti. Il programma verso le scuole richiederà release affidabile, Education Kit verificato, controllo legal/privacy del canale e autorizzazione esplicita del maintainer. Il pubblico Astrolabio/astronomia resta separato e attende l'eventuale pubblicazione del progetto open hardware.
