# Desktop · HTTPS nativo PKCE: candidato per revisione

**Stato: review candidate, NOT activated. Non è un login funzionante.**

Questo incremento segue le PR Desktop #353–#360, in particolare il coordinator
Rust-only della PR #360. Il sorgente `src-tauri/src/pkce_reqwest_https.rs`
propone un adattatore `TokenHttpTransport` concreto che fa **un solo POST** al
token endpoint staging. Il modulo ora è compilato e il lockfile è stato
rigenerato con Cargo, ma rimane **non attivato**: non è istanziato dal flusso
di login né esposto via IPC.

## Controlli implementati nel candidato

- Il port rifiuta in partenza URL diversi dall'allowlist HTTPS staging già
  presente in `pkce_token_exchange.rs`; rifiuta payload vuoti o oltre 2048 B,
  deadline assente o oltre 10 s, limite di risposta oltre 8192 B.
- `reqwest::blocking::Client` con `rustls`, `https_only(true)`, verifica TLS
  standard di CA e hostname, nessun certificato/host insicuro, nessun proxy
  ambientale, nessun cookie store, nessun Referer e redirect **disabilitati**.
- Un solo POST `application/x-www-form-urlencoded`, `Accept: application/json`,
  body da `SecretFormReader` con memoria cancellata in `Drop`; nessun retry del
  codice monouso. Il limite della risposta è applicato a **byte ricevuti**,
  anche se il server invia Content-Length falso o trasferimento chunked.
- Per qualsiasi stato diverso da 200 (inclusi 3xx) non legge il body e passa
  un errore opaco al parser dell'exchange; il codice non legge né usa `Location`.
- Nessuna stampa, Telemetry del body, Tauri command, UI, account o storage.

Limitazione: come qualsiasi client TLS/HTTP, la dipendenza può copiare in
buffer interni i byte del body; `SecretFormReader` zeroizza **la copia che
possiede**, non può garantire la cancellazione delle copie interne di
reqwest/hyper. Il sistema operativo deve inoltre poter validare le CA e il DNS.
Il timeout non annulla immediatamente una request quando un altro thread
chiama `LoginCancelHandle::cancel`; la race del token è già gestita dal
coordinator della PR #360. In caso di errore di rete non ritentare lo stesso
authorization code: serve un nuovo tentativo PKCE.

## Gate di attivazione (eseguire nel checkout completo Windows)

Nel checkpoint precedente il blocco era **Rust toolchain unavailable**. Nel
worktree Windows successivo Cargo ha generato il lock TLS e `cargo check` è
passato; il test di rete HTTPS e la revisione delle dipendenze restano aperti.
La seguente sequenza conserva le istruzioni riproducibili.

1. In un checkout completo che include le PR stacked e con Rust 1.90+
   disponibile, creare una feature branch di integrazione dal candidato.
2. Aggiungere al `src-tauri/Cargo.toml`:

   ```toml
   reqwest = { version = "=0.13.5", default-features = false, features = ["blocking", "rustls"] }
   ```

3. Eseguire `cargo check --manifest-path src-tauri/Cargo.toml` **senza**
   `--locked` per fare generare da Cargo il nuovo `Cargo.lock`; revisionare il
   diff delle dipendenze TLS (non inserirle o sostituirle a mano).
4. Solo allora inserire `mod pkce_reqwest_https;` in `src-tauri/src/lib.rs`.
   Non aggiungere Tauri IPC e non attivare il flag staging. L'adattatore viene
   compilato, ma un futuro worker nativo deve ancora istanziarlo esplicitamente.
5. Eseguire su Windows 11:

   ```powershell
   cargo test --manifest-path src-tauri/Cargo.toml pkce_reqwest_https::tests --locked
   cargo test --manifest-path src-tauri/Cargo.toml pkce_staging_flow::tests --locked
   cargo test --manifest-path src-tauri/Cargo.toml pkce_token_exchange::tests --locked
   cargo check --manifest-path src-tauri/Cargo.toml --locked
   node --test tests/pkce-https-adapter-source.test.mjs
   ```

   Il source-contract test verifica che il modulo compilato non sia collegato
   all'IPC. Compilazione non significa attivazione o verifica TLS end-to-end.
6. Aggiungere test di integrazione staging con TLS valido, certificato
   invalido, redirect 302/307, timeout, 8 KB superati (Content-Length corretto
   e falso), errore del server e cancellazione durante la richiesta; nessun
   account reale o backend produzione. Verificare anche macOS prima del rilascio
   per quel sistema.

## Non cambia

- Nessun nuovo permesso Tauri o attivazione frontend.
- Nessun deployment, AWS, migrazione, GitHub Actions, release o merge su `main`.
- Il backend staging non è attivato, non esiste un refresh token; il token di
  accesso scade dopo al massimo 900 s, quindi **sessione persistente assente**.
- Il candidato non costituisce una connessione di login o un test HTTPS eseguito.

Documentazione tecnica consultata: [reqwest 0.13.5 blocking](https://docs.rs/reqwest/0.13.5/reqwest/blocking/index.html),
[ClientBuilder](https://docs.rs/reqwest/0.13.5/reqwest/blocking/struct.ClientBuilder.html),
[Cargo features](https://docs.rs/crate/reqwest/0.13.5/features).
