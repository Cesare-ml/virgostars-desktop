# VirgoStars Desktop · Sessione PKCE nativa temporanea

**Status: prototype, Rust-only, staging non abilitato, test nativi da eseguire.**
Incremento stacked sul candidato HTTPS #361. Non è un login usabile da UI.

`src-tauri/src/pkce_native_session.rs` contiene il proprietario nativo **di
un singolo tentativo**, `NativeLoginSession`:

1. Convalida il timeout richiesto (maggiore di zero, massimo 600 s), poi invoca
   `StagingLoginAttempt::begin(...)`, che controlla endpoint allowlisted,
   prepara il callback 127.0.0.1 e apre la pagina di consenso staging.
2. Sposta in un thread Rust dedicato il loopback e lo scambio token mediante
   l'interfaccia `TokenHttpTransport`; oggi può essere una finta implementazione
   nei test. Il reale adattatore HTTPS della PR #361 **non è attivato**.
3. Mantiene in una `Mutex` nativa il grant `Zeroizing<String>` fino alla
   scadenza o alla disconnessione. Il WebView non riceve token.
4. Espone soltanto `NativeLoginSnapshot {attempt_id, phase,
   remaining_seconds}`: le fasi sono pending/connected/failed/cancelled/expired/
   disconnected. Il metodo `snapshot()` rimuove il grant scaduto dalla RAM.
5. `cancel()` interrompe solo il login in corso (compare-and-swap già presente
   nel coordinator); `disconnect()` elimina localmente un grant già ottenuto e
   impedisce a un risultato tardivo di ricrearlo. `Drop` effettua la stessa
   pulizia. Nessun comando di revoca server è implicito.

## Confini e limiti espliciti

- Il worker non è ancora collegato a `tauri::generate_handler!` né alla UI;
  manca un **owner singleton** a livello di applicazione con politica one-
  active-attempt e comandi `start/status/cancel/disconnect` strettamente
  autorizzati. Questo modulo contiene una sessione, non la registry globale.
- `start` può ancora bloccare il chiamante per l'apertura del browser; il
  futuro host deve lanciarlo lontano dal thread UI/async executor e non deve
  creare worker illimitati. Il thread di callback ha timeout, lo scambio HTTP
  massimo 10 s nel contratto esistente; l'annullamento durante una richiesta
  di rete non è istantaneo.
- Non esiste un **refresh token** né un contratto di revoca server. Il backend
  staging offre al massimo 900 s di access token; questa sessione è volatile,
  non è un accesso persistente offline, e `disconnect()` non revoca server-side
  un access token già scambiato. Non chiamarla autenticazione definitiva.
- Non è stato modificato il backend, AWS, le credenziali, il database, la
  distribuzione pubblica, `Cargo.toml` o `Cargo.lock`. Nessun deploy/merge.
- Il codice **non** implementa chiamate ai dati natali: serve un client API
  separato che verifichi autorizzazioni e proprietà lato server.

## Test

Nel presente ambiente senza Rust/Cargo sono stati eseguiti solo i controlli
source-level Node. I test Rust scritti simulano browser senza callback,
callback 127.0.0.1, falso HTTP e transizioni pending → connected →
disconnected, annullamento e URL rifiutato prima dell'apertura del browser.

Da eseguire nel checkout Windows 11 con tutte le PR stacked, **prima del merge**:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml pkce_native_session::tests --locked
cargo test --manifest-path src-tauri/Cargo.toml pkce_staging_flow::tests --locked
cargo check --manifest-path src-tauri/Cargo.toml --locked
node --test tests/pkce-native-session-source.test.mjs
```

Poi verificare snapshot pubblici senza segreti, spegnimento della finestra
durante callback, race cancel/HTTP/disconnect, scadenza e ritorno offline su
Windows. Il real client HTTP resta nella separata PR review-only #361 finché
un toolchain Rust non rigenera e verifica `Cargo.lock` con TLS.
