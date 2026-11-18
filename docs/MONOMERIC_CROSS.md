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

**Limiti espliciti:** il Maestro dell'Ora è ancora scelto manualmente: non si
deduce da sola la regola di alba/tramonto della nascita. L'app non dispone oggi
di un provider locale verificato per gli eventi solari, e calcolarne uno nuovo
nel solo layer Angular violerebbe la separazione astronomia/astrologia del
progetto. Le descrizioni hanno significato storico-simbolico, non costituiscono
interpretazioni, diagnosi o previsioni.

**Gate diritti e provenienza:** il catalogo è stato trasferito dai sorgenti
legacy della stessa organizzazione in una **PR desktop in bozza** per
prototipazione. Non distribuire una release o dichiarare le frasi liberamente
redistribuibili prima della verifica dei diritti su testi e trascrizioni.

Prima della release: integrare alba/tramonto sorgente-verificati con il
`PlanetaryHoursSchedule` esistente nel pacchetto di calcolo; approvare il
catalogo e i diritti sui testi; test di render desktop Windows, macOS,
mobilità dello zoom e stampa.
Un vecchio PDF personale non va copiato nei test di repository.

Rollback: rimuovere il pulsante e la presentazione `monomeric-cross`, senza
modificare il WebGL lifecycle della ruota. Nessun cambiamento ad auth, sync,
privacy, update, IPC o asset originali.
