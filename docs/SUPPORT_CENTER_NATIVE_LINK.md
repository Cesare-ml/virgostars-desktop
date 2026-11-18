# VirgoStars Desktop — accesso al Centro assistenza

Stato: **PROTOTYPE / draft PR**, non integrato in una release. Collegato a
[virgostars-desktop#346](https://github.com/Cesare-ml/virgostars-desktop/issues/346)
e alla preselezione web [virgo-stars#352](https://github.com/Cesare-ml/virgo-stars/pull/352).
La gestione di screenshot resta nell'altra PR del sito, [virgo-stars#333](https://github.com/Cesare-ml/virgo-stars/pull/333).

## Comportamento

- Il menu laterale contiene **Centro assistenza / Help Center**, con testo accessibile anche quando il menu è compattato.
- L'utente attiva manualmente il comando; solo allora il Rust host apre nel **browser di sistema** l'URL fisso `https://www.virgostars.it/supporto?source=desktop`.
- Se il comando nativo fallisce, il client mostra un messaggio generico IT/EN e continua a funzionare offline; non espone dettagli di eccezione.
- In `npm start` (browser di sviluppo), il collegamento apre una nuova scheda.
- La pagina web deve essere pubblicata con la PR #352 affinché `source=desktop` preselezioni il prodotto; fino ad allora l'utente può sceglierlo manualmente.

## Sicurezza e privacy

Il client non allega log, screenshot, tema, identificatori, token, data/ora, dispositivo, account o dati personali.
Il metodo Tauri `open_support_center` non riceve parametri: il Rust host conserva il solo URL letterale.
La libreria nativa `tauri-plugin-opener` è registrata **senza aggiungere capability WebView**:
`src-tauri/tauri.conf.json` continua con `capabilities: []`, CSP offline e una sola finestra locale.
Un allowlist nel controllo `verify-native-ipc.mjs` accetta soltanto questo plugin, questo URL e questo handler,
rifiutando ulteriori plugin, URL modificati e invocazioni con parametri.

**Questa apertura è una eccezione intenzionale all'offline-only** perché è esplicitamente richiesta dall'utente e indirizza
al browser di sistema. Non autorizza nuove richieste HTTP dal WebView né telemetria automatica.

## Blocco di build da risolvere su Windows

È stata aggiunta la dipendenza Rust `tauri-plugin-opener = "2"`, ma **`src-tauri/Cargo.lock` non è ancora aggiornato**:
qui non è disponibile Cargo né l'accesso al registry per rigenerarlo in modo affidabile.
Non fare merge o usare `--locked` fino ad aver rigenerato, verificato e committato il lockfile.

Nel checkout Windows autorizzato, partendo dal branch della PR:

```powershell
cd D:\GitHub\virgostars-desktop\src-tauri
cargo check
git diff -- Cargo.lock
cargo test --locked
cd ..
npm.cmd test
npm.cmd run verify:ipc
npm.cmd run build:ui
npm.cmd run tauri:dev
```

Esaminare le nuove crate/licenze/vulnerabilità e verificare che il diff del lock non aggiorni dipendenze non collegate.
Se la lock regeneration o l'audit fallisce, **fermarsi**, non forzare la build né disabilitare i controlli.

## Collaudo manuale richiesto

1. In Tauri su Windows 11 x64: cliccare Centro assistenza con menu espanso e compattato; il browser predefinito,
   non una finestra WebView, deve mostrare il modulo supporto.
2. Con sito aggiornato: il prodotto deve risultare Desktop; nessun dato natale o log deve apparire nel link.
3. Simulare browser non disponibile e funzionamento offline: nessun crash né blocco dell'app, messaggio generico se il comando nativo fallisce.
4. In `npm start`, aprire il link in scheda separata senza alterare il rendering.
5. Verificare IT/EN, navigazione da tastiera, contrasto e nessuna nuova permission, CSP o connessione dal WebView.

Nessuna modifica ad AWS, sync, autenticazione, storage, site admin, release o branch `main`.
