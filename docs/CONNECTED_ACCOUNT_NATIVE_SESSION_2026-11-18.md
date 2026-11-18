# VirgoStars Desktop · Sessione PKCE nativa temporanea

**Status: prototype, staging esplicito disabilitato per default, non live-tested.**
La UI e l'IPC sono collegati soltanto nel candidato descritto in
`CONNECTED_ACCOUNT_IPC_DISABLED_BRIDGE_2026-11-18.md`; senza feature e
configurazione staging il comando risponde disabled.

`src-tauri/src/pkce_native_session.rs` contiene il proprietario nativo **di
un singolo tentativo**, `NativeLoginSession`:

1. Convalida il timeout richiesto (maggiore di zero, massimo 600 s), poi invoca
   `StagingLoginAttempt::begin(...)`, che controlla endpoint allowlisted,
   prepara il callback 127.0.0.1 e apre la pagina di consenso staging.
2. Sposta in un thread Rust dedicato il loopback e lo scambio token mediante
   l'interfaccia `TokenHttpTransport`; nei test è un'implementazione finta.
   L'adattatore HTTPS compilato è usato soltanto dalla feature staging esplicita.
3. Mantiene in una `Mutex` nativa il grant `Zeroizing<String>` fino alla
   scadenza o alla disconnessione. Il WebView non riceve token.
4. Espone soltanto `NativeLoginSnapshot {attempt_id, phase,
   remaining_seconds}`: le fasi sono pending/connected/failed/denied/cancelled/expired/
   disconnected. Il metodo `snapshot()` rimuove il grant scaduto dalla RAM.
5. `cancel()` interrompe solo il login in corso (compare-and-swap già presente
   nel coordinator); `disconnect()` elimina localmente un grant già ottenuto e
   impedisce a un risultato tardivo di ricrearlo. `Drop` effettua la stessa
   pulizia. Nessun comando di revoca server è implicito.

## Confini e limiti espliciti

- La registry globale impone un solo tentativo ed è accessibile alla UI solo
  attraverso l'IPC versionato e la feature staging esplicita. La verifica del
  backend reale, i test TLS e il collaudo Windows restano aperti.
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
