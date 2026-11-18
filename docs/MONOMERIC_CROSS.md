# Croce monomerica — integrazione desktop (prototype)

La schermata del tema ora espone il pulsante **Croce** accanto alle viste
**Elementi** e **Aspetti**. La vista usa il componente Angular di
`astrological-charts` e la geometria di
`astrological-functions/monomeric-cross`. Legge le sette longitudini
tradizionali e le cuspidi della domificazione attiva dal tema già calcolato;
non fa nuove chiamate al server o al runtime nativo e non salva dati.

La schermata collega anche **360 descrizioni source-label** conservate nel vecchio
`frontend/vecchi_codici/dashboard/strumenti/monomeri.ts` del repository
`Cesare-ml/virgo-stars`, corrispondenti alla tradizione del *Serto di Iside*.
Un piccolo resolver locale, testato e senza rete, restituisce i testi dei quattro
punti e i testi dei relativi governatori. La vista espone due modalità:

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
La Croce viene quindi generata automaticamente per il pianeta che governa la
precisa ora temporale di nascita. Un pianeta scelto manualmente prevale sempre;
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

Il produttore nativo **non è ancora collegato**. Nel repository
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
Un vecchio PDF personale non va copiato nei test di repository.

Rollback: rimuovere il pulsante e la presentazione `monomeric-cross`, senza
modificare il WebGL lifecycle della ruota. Nessun cambiamento ad auth, sync,
privacy, update, IPC o asset originali.
