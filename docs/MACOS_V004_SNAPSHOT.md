# Mac v0.0.4 snapshot — isolated from main

- Source baseline: official published tag `v0.0.4` at commit `cbaf7d02f1c4c4dd2f92404a4aa1a3fb6e722629`.
- Source tree at the tag still declares `0.0.2` in six version fields, and predates Mac build tooling.
- This temporary branch starts from that exact commit, then changes **only** Mac build helpers/workflow, tests, documentation and metadata versions to `0.0.4`.
- Original `v0.0.4` Git tag and Windows Release are **not modified**. This snapshot commit is a Mac-port candidate, **not bit-for-bit identical to the tagged source**.
- The workflow is test-only; unsigned/ad-hoc; synthetic graphical assets; base public DE441 (1000–2200) and city catalog, without all optional data.
- No deployment, no release publication, no Apple secrets; use only the artefacts from the build run to validate the Mac port.
- This snapshot includes a scoped, one-time **push trigger** authorized for the initial run. The default `main` workflow remains manual-only.

## Primo tentativo e fix di portabilità

Il run 44783480637 è fallito prima di Rust/Tauri in `npm test` (13 fail ARM64 / 12 Intel). In questo aggiornamento, senza indebolire le policy CSP o di packaging:
- Il gate di sicurezza Tauri controlla un `userAgent` vincolato esattamente alla versione 0.0.4 (supportando la storica 0.0.2 per i suoi test); continua a rifiutare ogni altro attributo di finestra o cambio CSP.
- Il fixture Windows del Desktop Doctor dichiara esplicitamente x64, indipendentemente dall'architettura host Mac.
- Il test delle ore planetarie esercita il vero builder del checkout fratello pinnato, perché la root del package non lo espone ancora; la UI resta non convalidata per questo punto.
- I test di recovery Windows usano una directory temporanea fisicamente canonica quando `/var` è un alias macOS; il rifiuto dei symlink della recovery reale resta invariato.
- Il test privacy con nomi diversi solo per maiuscole viene saltato esclusivamente quando il volume del runner non può rappresentare entrambi, mantenendo invariato l'audit della build.
- Si include lo script pubblicazione già revisionato nel `main` per i contratti statici; nessuna release viene pubblicata.

## Secondo tentativo — gate IPC

Nel run 44786607615, `npm test` ARM64 ha superato 1080 test, 0 falliti e 2 saltati. Il successivo gate `verify:ipc` ha respinto lo snapshot perché il valore SHA-256 fissato per `src-tauri/build.rs` non corrispondeva più al codice effettivo già presente nel tag v0.0.4. Il file reale (835 byte) contiene solo il caricamento opzionale del catalogo stelle su `OUT_DIR` e `tauri_build::build()`, senza plugin o IPC aggiuntivi. È stato letto e il suo SHA-256 confermato (`5b5317f84fdde87bbea8a2e2f7719e1453c195ea386d17643806bf9f3d626565`); viene aggiornata **solo l'impronta pin**, lasciando inalterati tutti i controlli su plugin, comandi, adapter e capabilities.

## Terzo tentativo e dipendenze API pubbliche

Run 44787065295: 1080 test riusciti, 0 falliti, due skipped; IPC gate superato, ma Angular non compila perché i package pubblici pinati non esportano le API richieste dallo snapshot Windows 0.0.4 (Regolo grouped Arabic parts, star contacts, SolarReturnStripComponent e opzioni/interazioni renderer più recenti). Questo ramo **non finge** la presenza di questi calcoli. La prima build Mac usa un gate *fail-closed* per le parti arabe e i contatti stellari, disabilitando l'interfaccia corrispondente e mostrando che non è disponibile; non crea longitudes o contatti. La tabella di anteprima rivoluzione mostra soltanto posizioni/cuspidi già calcolate dal motore senza simulare il componente 3D upstream. Le opzioni renderer mancanti non vengono passate al vecchio Charts. Questo intervento è **esclusivo della build Mac sperimentale** e non deve essere pubblicato come release funzionalmente equivalente a Windows.

Per ripristinare la parità occorrono contratti upstream pubblicati e testati di `astrological-functions` e `astrological-charts`, compresa la verifica del rendering delle stelle fisse e dei segni/assi sinastria.

## Quarto tentativo — licenze macOS
Run 44794676098: Angular e i test sono stati superati, il catalogo città e le effemeridi DE441 sono stati verificati. L'inventario Cargo su ARM64 si è fermato su `block2@0.6.2`, un crate Apple il cui pacchetto Cargo non include il testo MIT riconosciuto dallo scanner. La licenza è stata verificata dal tag ufficiale `madsmtm/objc2` `block2-0.6.2` (`b4167b58...`). Il testo MIT viene conservato per la famiglia `block2/objc2` solo quando Cargo dichiara esplicitamente una scelta MIT, senza modificare il fallimento per librerie sconosciute e senza utilizzare asset Apple privati. Referenza file: `third-party/cargo-license-fallbacks/objc2-MIT-reviewed.txt` dalla versione ufficiale del progetto objc2 (sha `8a5abacd90d5403fc0463459a35826f892b9142e`).

## Quinto tentativo — dispatch2 e diagnosi completa
Nel run 44795361796 il prossimo crate senza licenza in archivio era `dispatch2@0.3.1`. È un crate del medesimo workspace `madsmtm/objc2`, tag `dispatch2-0.3.1` al commit `8852b424...`, che dichiara espressamente l'opzione MIT. Viene quindi incluso nella stessa famiglia di fallback del testo MIT già verificato. Lo script ora raccoglie e segnala **tutte** le eventuali licenze senza testo riconosciuto prima di interrompere il packaging; non autorizza mai pacchetti sconosciuti né elimina i controlli.
