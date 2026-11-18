# VirgoStars Desktop · Registro nativo unico del login

**Stato: prototipo inerte, compilazione Rust/Windows ancora da verificare.**
Incremento sovrapposto alla PR #362 (sessione PKCE nativa).

## Funzionalità introdotte

`src-tauri/src/pkce_native_registry.rs` contiene `NativeLoginRegistry`:

- Mantiene uno **slot singolo**: `Idle`, `Starting` oppure
  `Active(NativeLoginSession)`. Un secondo tentativo è rifiutato con `Busy`.
- Installa la prenotazione dello slot sotto `Mutex` **prima** dell'apertura
  del browser, ma rilascia il mutex durante l'apertura per permettere
  `snapshot()` e `shutdown()` anche se l'OS tarda.
- Se la chiamata di `start` fallisce, libera lo slot per un nuovo tentativo.
- `snapshot()` comunica soltanto idle/starting/active/closed/unavailable. Il
  sotto-stato active contiene ID opaco, fase e secondi restanti; **mai** token,
  codice PKCE, verifier o URL del callback.
- `cancel(expected_attempt_id)` vale **solo per un tentativo pendente con ID
  esatto**. `disconnect(expected_attempt_id)` elimina la sessione locale e
  rifiuta ID già superati, così un vecchio click non può annullare un login
  successivo.
- `shutdown()` è definitivo, scarta il grant in RAM e invalida una
  prenotazione `Starting` ancora occupata da un browser lento. Una risposta
  tardiva non può reinstallare una sessione dopo la chiusura.

I test Rust con browser/trasporto finti simulano una seconda richiesta
concorrente, un ID vecchio, un URL backend non consentito e la chiusura
mentre l'apertura browser è bloccata. Nessun dato reale o request HTTPS.

## Cosa non abilita

- Nessun Tauri IPC registrato, pulsante UI, flag staging, login online o
  accesso ai dati di astrologia. Il gestore **deve essere istanziato una sola
  volta** dal futuro host nativo. Non viene ancora usato dalla WebView.
- Per policy di sicurezza, il gestore non è configurato con un client HTTPS:
  l'adattatore `reqwest` resta candidato review-only nella PR #361.
- La chiamata `start()` può bloccare mentre l'OS apre il browser; il futuro
  host la lancerà su un executor nativo limitato, mai sul thread UI.
- Non esiste **refresh token**, revoca remota o persistenza di credenziali;
  i token attuali scadono entro 900 secondi. Le funzioni di questo prototipo
  non autorizzano dati di altri utenti sul backend.
- Nessuna modifica ad AWS, backend, database, `Cargo.toml`, `Cargo.lock`,
  GitHub Actions, distribuzione, release o branch `main`.

## Verifiche ancora necessarie

Il container di authoring non dispone della **Rust toolchain**. I controlli
Node sono source-contract, non sostituiscono test di comportamento Rust.
Sul checkout Windows con l'intera catena stacked:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml pkce_native_registry::tests --locked
cargo test --manifest-path src-tauri/Cargo.toml pkce_native_session::tests --locked
cargo check --manifest-path src-tauri/Cargo.toml --locked
node --test tests/pkce-native-registry-source.test.mjs
```

Collaudare anche doppio click di login, chiusura finestra durante browser lento,
ID di tentativo scaduto, risposta HTTP dopo disconnect e shutdown, avvio
offline, e i casi Windows WebView2. Attivazione del trasporto e del token
refresh richiedono ulteriori PR e test staging prima dell'uso reale.
