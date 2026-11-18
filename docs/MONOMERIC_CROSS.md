# Croce monomerica — integrazione desktop (prototype)

La schermata del tema ora espone il pulsante **Croce** accanto alle viste
**Elementi** e **Aspetti**. La vista usa il componente Angular di
`astrological-charts` e la geometria di
`astrological-functions/monomeric-cross`. Legge le sette longitudini
tradizionali e le cuspidi della domificazione attiva dal tema già calcolato;
non fa chiamate al server e non salva dati.
La geometria resta locale; soltanto quando si apre la Croce viene effettuato
un nuovo comando **read-only** al runtime Tauri per richiedere gli eventi solari.
Il comando attuale è uno stub esplicitamente indisponibile, non un calcolo.

La schermata collega anche **360 descrizioni source-label** conservate nel vecchio
`frontend/vecchi_codici/dashboard/strumenti/monomeri.ts` del repository
`Cesare-ml/virgo-stars`, corrispondenti alla tradizione del *Serto di Iside*.
Un piccolo resolver locale, testato e senza rete, restituisce i testi dei quattro
punti e i testi dei relativi governatori. La vista espone due modalità:

**Priorità aggiornata dal mantenitore:** in Desktop il Maestro dell'Ora deve
essere calcolato **automaticamente** dalla data/ora UTC del tema, dal luogo e
da tre eventi solari reali (alba prima della nascita, tramonto, alba dopo).
Non dipende dai domicili: questi servono **solo** a trovare il governatore del
segno del singolo braccio. `astrological-functions/monomeric-cross` conserva
ora anche `signRulerDomicile` (`PRIMARY`/`SECONDARY`), derivato dai codici
`dop` e `dos` della *Tabella dei peregrini* fornita dal mantenitore. Le altre
dignità (`esa`, `cad`, `esp`, `ess`, `pa`, `pm`, `pb`) non attribuiscono il
governatore del segno.

Il produttore astronomico in Rust è **ancora bloccato** dalle PR Ephemeris non
integrate. Un comando Tauri `calculate_solar_events` è ora registrato come
confine di integrazione con protocollo v1. Il trait Rust `SolarEventsProvider`
permette un produttore di eventi iniettato e testabile: riceve un istante UTC
e coordinate validati, dichiara la copertura temporale e restituisce uno
snapshot tipizzato con osservatore (altezza compresa), orizzonte, rifrazione,
algoritmo, sorgente/kernel/modello temporale ed eventi UTC o indisponibilità
polare. Il codice nativo non implementa alcun algoritmo astronomico.
Il provider di produzione è ancora assente: per dati validi risponde
`provider_unavailable` e `snapshot:null`, senza inventare eventi; gli input
invalidi rispondono `invalid_request`. La schermata dichiara apertamente
questa indisponibilità. I sette
pulsanti manuali e l'inserimento manuale dei tre eventi sono conservati solo
in un `<details>` **chiuso per impostazione predefinita e marcato "strumenti
di prova temporanei"**, per permettere QA grafico senza fingere un risultato
natalizio. Una futura interfaccia manuale didattica è candidata per gli articoli
del sito, non per il flusso primario Desktop. Lo stato del Maestro automatico
non deve mai essere dedotto dal solo giorno della settimana.

- **Grado mostrato (0–29)**: usa la parte intera del grado nel segno, come nel
  mockup 4°56′ Ariete → etichetta 4. È una scelta di visualizzazione
  **non attribuita alla procedura storica di Angelini**.
- **Costesèque 1940**: con precisione a minuti interi associa 00′–30′ al punto
  inferiore, 31′–59′ a quello superiore, mantenendo anche i due simboli
  adiacenti. I due simboli vicini per ciascun braccio sono mostrati in un
  pannello dedicato. È una variante storica esplicita, **non l'impostazione
  automatica di Angelini**.

La distinzione è stata verificata contro il lavoro in
`Cesare-ml/virgostars-documenti-astrologici`, in particolare
`TECH-THEBAN-MONOMER-RESOLVER`, `TECH-COSTESEQUE-DEGREE-SYMBOL-ACTIVATION` e
`research/corpora/angelini-serto-iside/theban-monomers/summary.md`. Il confronto
fra catalogo legacy e fonte primaria resta una revisione editoriale da completare:
ad esempio una voce riporta «lega» dove la ricerca trascrive «legna».
Il software preserva il testo legacy, non inventa correzioni né interpretazioni.

**Maestro dell'Ora:** oltre alla selezione diretta del pianeta, l'utente può
inserire *alba iniziale, tramonto e alba successiva* come data e ora **locali**
nel fuso orario del tema. Il modulo `manual-planetary-hour` converte gli orari
in UTC, rifiuta le ore inesistenti e quelle **ripetute/ambigue** al cambio di
ora (il campo `datetime-local` non contiene l'offset UTC), controlla le date
impossibili e deriva il giorno della
settimana dall'**alba iniziale locale** e usa i contratti già testati
`buildPlanetaryHours` + `lookupPlanetaryHour` di `astrological-functions`.
Nella modalità di prova la Croce viene così costruita per il pianeta che
governa l'ora temporale calcolata dagli orari forniti. Il Maestro automatico
del provider, quando disponibile, prevale sempre sulla selezione di prova;
cambiando tema i tre orari vengono azzerati, evitando dati di un'altra nascita.
I valori inseriti non sono salvati né inviati al backend.

**Limiti espliciti:** non viene ancora calcolata automaticamente la posizione
astronomica del Sole sull'orizzonte. Gli orari solari devono provenire da una
fonte controllata dall'utente e sono etichettati come
`CALLER_SUPPLIED_NOT_ASTRONOMICALLY_VERIFIED`; per nascite prima dell'alba bisogna
inserire l'alba del **giorno precedente**. L'app non dispone oggi di un provider
locale verificato per gli eventi solari, e calcolarne uno nuovo in Angular
violerebbe la separazione astronomia/astrologia del progetto. Le descrizioni
hanno significato storico-simbolico, non costituiscono interpretazioni,
diagnosi o previsioni.

Se un evento solare cade in un'ora ripetuta al ritorno all'ora solare, la
schermata mostra un errore specifico: non sceglie implicitamente la prima delle
due occorrenze. Servono letture UTC dotate di provenienza o il futuro provider
astronomico nativo; la UI manuale non può rappresentare un offset per
disambiguare. Questa regola riguarda solo gli eventi **inseriti manualmente**,
senza modificare la navigazione civile del tema.

**Gate diritti e provenienza:** il catalogo è stato trasferito dai sorgenti
legacy della stessa organizzazione in una **PR desktop in bozza** per
prototipazione. Non distribuire una release o dichiarare le frasi liberamente
redistribuibili prima della verifica dei diritti su testi e trascrizioni.

## Collegamento con VirgoStars-Ephemeris: preparato, non ancora attivato

Esiste il modulo puro `src/app/astro/ephemeris-planetary-hour.ts`, che riceve
un risultato `SolarEventAdapterInput` da un **futuro** comando astronomico
locale, verifica che latitudine e longitudine corrispondano al tema, che il
giorno civile sia quello dell'alba **nel fuso del tema**, valida i metadati
tramite `astrological-functions/planetary-hours-solar-adapter` e risolve l'ora.
Il risultato preserva l'identificatore del kernel, algoritmo, orizzonte e
rifrazione e mantiene il flag `CALLER_ASSERTED_NOT_SCIENTIFICALLY_VERIFIED`.
Non è una verifica di precisione indipendente.

Il produttore di eventi nativo **non è ancora collegato al core astronomico**.
Il nuovo modulo `src/app/native/solar-events-contract.ts` valida e copia i
campi della risposta Tauri e passa gli snapshot al resolver esistente, solo
quando una futura versione del comando restituirà effettivamente `ok`.
Verifica luogo del tema, fuso e giorno locale dell'alba, intervallo di nascita,
provenienza dichiarata e struttura dell'envelope. L'interfaccia usa il risultato
automatico **prima** di qualsiasi parametro manuale; una risposta arrivata
dopo un cambio tema, navigazione, chiusura della vista o distruzione del
componente viene ignorata. Nel browser non parte alcuna chiamata Tauri.
Il comando ha una scadenza locale di **5 secondi**: se il runtime resta in
attesa, la UI mostra indisponibilità e ignora la risposta tardiva; non annulla
né ripete l'operazione nativa, che è strettamente read-only.
Un `ok` in un test con eventi sintetici dimostra il percorso software, **non**
la validità di un evento astronomico o l'esistenza di un provider Rust attivo.
Il **giorno della settimana non viene dichiarato dal produttore Rust**:
Desktop lo ricava dall'alba iniziale UTC convertita nel fuso IANA del tema.
Questo copre le nascite prima dell'alba, per cui vale il **giorno planetario
precedente**, e i luoghi dove l'alba è già nel nuovo giorno civile locale ma
non in UTC. Sono presenti fixture sintetiche per la 23ª ora notturna e Tokyo.

Nel repository
`Cesare-ml/VirgoStars-Ephemeris` il lavoro pertinente esiste già nelle PR
[#304](https://github.com/Cesare-ml/VirgoStars-Ephemeris/pull/304) (eventi
geometrici), [#309](https://github.com/Cesare-ml/VirgoStars-Ephemeris/pull/309)
(rifrazione + alba/tramonto convenzionali) e
[#419](https://github.com/Cesare-ml/VirgoStars-Ephemeris/pull/419)
(API di esposizione). Sono impilate su altre dipendenze e non vanno aggirate.
La [issue #432](https://github.com/Cesare-ml/VirgoStars-Ephemeris/issues/432)
descrive i gate di revisione e integrazione prima di poter aggiornare il
commit Rust fissato da Desktop. Non si crea un algoritmo duplicato in Angular.

Prima della release: integrare alba/tramonto sorgente-verificati con il
`PlanetaryHoursSchedule` esistente nel pacchetto di calcolo; approvare il
catalogo e i diritti sui testi; test di render desktop Windows, macOS,
mobilità dello zoom e stampa.
Il nuovo protocollo Tauri richiede ancora una **compilazione Cargo su Windows**,
test di IPC WebView2 e revisione degli eventi solari. La verifica Node
`npm run verify:ipc` controlla ora **sei** comandi e sei adattatori; l'audit
non prova la compilazione Rust. Una futura risposta `ok` dovrà includere UTC,
convenzioni di orizzonte, rifrazione, modello del tempo e dataset effettivi.
Un vecchio PDF personale non va copiato nei test di repository.

Rollback: rimuovere il pulsante e la presentazione `monomeric-cross`,
il comando `calculate_solar_events` e il relativo adattatore, senza
modificare il WebGL lifecycle della ruota. Nessun cambiamento ad auth, sync,
privacy, update o asset originali, salvo l'aggiunta read-only e locale alla
superficie IPC qui documentata.
