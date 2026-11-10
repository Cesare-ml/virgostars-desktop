# VirgoStars Desktop — catalogo funzionale completo

Stato: **REQUISITI APPROVATI / non implementati** (2026-11-10).
Destinazione: applicazione professionale offline-first per astrologi e studiosi, Windows prima e macOS successivamente.
Questo documento definisce l'**obiettivo funzionale completo**: tutte le funzionalità nella sezione “Incluse” sono previste per VirgoStars Desktop, anche se non arriveranno necessariamente nella prima release. I dettagli di rilascio seguono i gate in [ROADMAP.md](ROADMAP.md). Non è una dichiarazione di disponibilità attuale.

## Regole di prodotto

- La **carta astrologica è sempre al centro, completamente visibile e grande quanto possibile**; menu laterali collassabili, pannelli contestuali, vista light/dark. Seguire le [linee guida UI (PR di design separata, non ancora integrata)](https://github.com/Cesare-ml/virgostars-desktop/blob/docs/ui-design-guidelines-light-dark-20261110/docs/UI_DESIGN_GUIDELINES.md) quando integrate dal relativo PR.
- Il programma autentica inizialmente un account VirgoStars; l'utente già autorizzato lavora anche offline sui dati locali e sincronizza quando online, nel rispetto di [OFFLINE_AUTH_AND_SYNC.md](OFFLINE_AUTH_AND_SYNC.md).
- Il client usa VirgoStars-Ephemeris (motore astronomico Rust), astrological-functions (logica astrologica), astrological-charts (render Three.js), astrological-assets (asset approvati) e, dove applicabile, VirgoStars-Event-Ephemeris. **Non duplicare i calcoli astronomici nel desktop**.
- Ogni funzione è attiva soltanto quando il motore effettivamente la supporta e supera i test: niente calcoli inventati, fallback silenziosi o API dichiarate pronte senza evidenze.
- Archiviazione di temi, preferenze e note su profilo autorizzato con protezione, backup, import/export e sincronizzazione progettati separatamente; nessun accesso diretto del desktop al database di produzione.
- I menu o componenti rimasti **commentati/disattivati in altri prototipi non fanno parte dello scope** solo per la loro esistenza nel codice. I requisiti di questo documento sono espliciti.

## F01 — Temi, soggetti, archivio e account

- [ ] F01.01 Creare, visualizzare, modificare, duplicare (nuova UX), salvare ed eliminare un tema/soggetto con conferma dove distruttivo.
- [ ] F01.02 Nome, data, ora, località, coordinate geografiche e fuso orario; opzione **ora di nascita sconosciuta** senza fabbricare case/assi.
- [ ] F01.03 Ricerca città/stati e inserimento manuale latitudine/longitudine in gradi, minuti, secondi e direzioni N/S/E/O; timezone e DST espliciti.
- [ ] F01.04 Note del tema, aggiornamento e sincronizzazione non distruttiva.
- [ ] F01.05 Archivio ricercabile per nome, con filtri per gruppo e selezione rapida dei temi.
- [ ] F01.06 Gruppi: creare, rinominare, eliminare, assegnare/rimuovere temi, anche con drag-and-drop accessibile.
- [ ] F01.07 **Tema Account**: elenco selezionabile di temi personali/preferiti; mantenere il comportamento di lista multipla (storicamente fino a 10), con vincolo finale definito da UX e dati.
- [ ] F01.08 Posizione di default configurabile; impostazione rapida di data/ora correnti.
- [ ] F01.09 Apertura di soggetto/tema tramite percorso o selezione archivio, recupero dello stato di lavoro.
- [ ] F01.10 Profili/account VirgoStars, stato online/offline, sincronizzazione differita e conflitti evidenti.

## F02 — Grafico astrologico e interazioni

- [ ] F02.01 Tema radix/carta astrologica circolare, dodici segni, dodici case, assi AS/DS/MC/IC e gradi.
- [ ] F02.02 Simboli dei pianeti/punti, moto retrogrado, evitamento collisioni, etichette e informazioni di precisione.
- [ ] F02.03 Aspetti disegnati come livelli selezionabili; hover, click, focus su pianeta/aspetto/anello e tooltips.
- [ ] F02.04 Anelli distinti per radix, transiti, sinastria, rivoluzioni, direzioni e altre tecniche supportate.
- [ ] F02.05 Navigazione temporale contestuale, zoom/pan/Fit, centro stabile e adattamento alla finestra.
- [ ] F02.06 Metadati leggibili: nome, data/ora, località, latitudine/longitudine, GMT/UTC, DST e timezone.
- [ ] F02.07 Indicatore del **pianeta dell'anno**.
- [ ] F02.08 Viste **chiara/scura** equivalenti, accessibilità da tastiera e tabella alternativa.
- [ ] F02.09 Esportazione grafici come immagine PNG ad alta risoluzione; JPEG/altre forme solo con contratto e test specifici.
- [ ] F02.10 Finestra/ispettore informazioni pianeti, stelle, selezioni, stati di caricamento e di errore.

## F03 — Impostazioni di calcolo e rappresentazione

- [ ] F03.01 Selettore domificazioni: **Egizia autonoma + tutti i metodi Swiss Ephemeris riprodotti dal motore VirgoStars-Ephemeris**. **NON includere “Egizia + Placido”.** Specifiche, codici e casi limite in [HOUSE_SYSTEMS.md](HOUSE_SYSTEMS.md).
- [ ] F03.02 Abilitazione individuale dei luminari e pianeti classici, Urano/Nettuno/Plutone, Chirone, Vertex, assi e punti; nodi lunari medi/veri Nord/Sud, apogeo/perigeo medi e osculatori.
- [ ] F03.03 Sorti configurabili: Tyche, Daimon, Basis, Ananke, Eros, Hermes, Tolma, Nike, Nemesi; visibilità distinta dalle formule di calcolo.
- [ ] F03.04 Configurare orbite per pianeta e per aspetto, partecipazione di un corpo agli aspetti e filtri di visualizzazione.
- [ ] F03.05 Opzione “Transaturnini se in congiunzione”.
- [ ] F03.06 Aspetti: congiunzione (0°), opposizione (180°), trigono (120°), quadrato (90°), sestile (60°), semiquadrato (45°), quintile (72°), biquintile (144°), quinconce (150°), semisestile (30°), semiquintile (36°), novile (40°), settile (~51,4286°), Phi solare (~222,49°), Phi lunare (~137,50°), parallelo e antiparallelo di declinazione.
- [ ] F03.07 Distinzione e filtro degli **aspetti applicativi e separativi** quando calcolabili.
- [ ] F03.08 Configurazioni salvate per account e usabili offline; rispetto dei parametri astrologici per ogni vista.

## F04 — Tempo reale, transiti e ricerca di eventi

- [ ] F04.01 “Adesso” / tempo reale con aggiornamento automatico, play/pausa e sincronizzazione corretta dell'istante.
- [ ] F04.02 **Correzione Tema**: data/ora/luogo, incrementi e decrementi per unità e passo, anteprima/ripristino/salvataggio.
- [ ] F04.03 Transiti in anello dedicato, data/ora di riferimento configurabile e confronto col radix.
- [ ] F04.04 **Ricerca sinodi**: corpi selezionabili; fasi D1/R2/R3/D4 dove definite; casi speciali per Luna, nodi e apsidi.
- [ ] F04.05 Navigazione sinodo precedente/successivo con passi 1, 5 o 10; rappresentazione del moto sinodico anche in tempo reale e relazione col radix.
- [ ] F04.06 **Ricerca ingressi** di pianeti/punti in segni, cuspidi di casa, assi AS/DS/MC/IC e longitudini di altri pianeti/punti.
- [ ] F04.07 Navigazione ingresso precedente/successivo con passi 1, 5 o 10.
- [ ] F04.08 **Congiunzioni con Saturno**: corpo partner selezionabile, eventi multipli, navigazione precedente/successiva 1/5/10.
- [ ] F04.09 Eventi da VirgoStars-Event-Ephemeris quando i dati risultano disponibili/validati; per intervalli mancanti usare il calcolo canonico e presentare copertura e precisione.
- [ ] F04.10 Separare graficamente “transito”, “data esatta dell'evento” e “tempo reale” senza cambiare involontariamente il tema radix.

## F05 — Previsioni, rivoluzioni e confronto temi

- [ ] F05.01 **Sinastria** di due temi salvati, anelli, inverti temi, transiti opzionali e confronto dei valori.
- [ ] F05.02 **Sinastria deflettiva** con vincolo di metodo documentato e scelta **defletti su casa 1–12**; non attribuire il metodo ad altre domificazioni senza validazione.
- [ ] F05.03 **Rivoluzione solare**: anno e località, erigi/salva tema e confronto sinastrico col radix.
- [ ] F05.04 **Mappa geografica delle rivoluzioni**: spostamento luogo, zoom/pan/reset, coordinate cursore, confronto case radix/rivoluzione, pianeti e segni.
- [ ] F05.05 **Rivoluzione lunare**: anno, località, elenco date, selezione evento e confronto col radix.
- [ ] F05.06 **Direzioni primarie semplificate**, **direzioni simboliche** e **tema progresso** come tre metodi distinti, documentati e verificati.
- [ ] F05.07 Navigazione del tempo per giorni, mesi, trimestri, anni, quinquenni, settenni e decenni; reset.

## F06 — Astrologia tradizionale, sorti e suddivisioni

- [ ] F06.01 **Dodecatemori**: tutti o selezione dei pianeti tradizionali; visualizzazione anche nella vista Elementi.
- [ ] F06.02 **Antisci**: croce cardinale/fissa/mutevole e modalità tutti, evidenziazione nel grafico.
- [ ] F06.03 **Parti Arabe** essenziali e catalogo **Abu Ma'shar** organizzato per casa.
- [ ] F06.04 **Creazione e visualizzazione formule di Parti Arabe** usando pianeti, nodi, assi AS/MC/DS/IC e case; la formula deve essere esplicita e verificabile.
- [ ] F06.05 **Kleros**: 4 Kleros, 5 planetarie, estrapolazione e visualizzazione delle sorti.
- [ ] F06.06 **Monomeri**: descrizione associata al grado del pianeta al passaggio/selezione.
- [ ] F06.07 **Decadi, decani e termini** con impostazioni e rendering dedicati.
- [ ] F06.08 **Ascendenze planetarie**: per pianeta/punto e asse AS/DS/MC/IC.
- [ ] F06.09 **Sinodi radix**: selezione pianeta tra Mercurio, Venere, Marte, Giove e Saturno e fasi D1/R2/R3/D4.

## F07 — Luna, stagioni, astrologia oraria ed elettiva

- [ ] F07.01 **Novilunio Radix**.
- [ ] F07.02 **Apogeo Radix** e rappresentazione grafica specifica.
- [ ] F07.03 **Lunazioni ermetiche** prima/dopo la nascita con selezione eventi/pianeti.
- [ ] F07.04 **Sizigie** per anno/luogo, elenco delle date e selezione del tema.
- [ ] F07.05 **Stagioni**: equinozio di primavera/autunno e solstizio d'estate/inverno, anno/luogo.
- [ ] F07.06 **Astrologia oraria**: erigere, denominare, salvare e riaprire il tema.
- [ ] F07.07 **Astrologia elettiva**: regolare data/ora/luogo, erigere, salvare e riaprire il tema.

## F08 — Grafici complementari e informazioni astronomiche

- [ ] F08.01 **Elementi**: rappresentazione della distribuzione nei segni e nelle case e opzione dodecatemori.
- [ ] F08.02 **Latitudini**: grafico planetario e fasi/moti latitudinali ove supportati.
- [ ] F08.03 **Ore planetarie**: grafico dedicato e relazioni con i pianeti.
- [ ] F08.04 **Effemeridi testuali**: data/ora di inizio e intervalli selezionabili in ore/giorni; scelta del corpo.
- [ ] F08.05 Colonne testuali: data/ora UTC, longitudine, velocità longitudinale, latitudine, velocità latitudinale, distanza in unità astronomiche.
- [ ] F08.06 **Effemeridi grafiche** con corpi selezionabili, avanzamento nel tempo e **inversione australe** dove definita.
- [ ] F08.07 **Info pianeti** in radix/transiti/sinastria: longitudine zodiacale/assoluta, velocità, latitudine, casa, coordinate equatoriali, eliocentriche e azimutali, ascensione retta/declinazione.
- [ ] F08.08 **Conversione calendario / date astronomiche** per radix, transiti e sinastria, con evidenziazione delle date.
- [ ] F08.09 **Stelle fisse** nel grafico, info contestuali (nome, magnitudine, longitudine, latitudine, distanza, azimut/altitudine ove disponibili).
- [ ] F08.10 **Collegamento al database interpretativo delle stelle fisse del sito VirgoStars**, con apertura della relativa scheda online: seguire [FIXED_STARS_INTEGRATION.md](FIXED_STARS_INTEGRATION.md).

## Esplicitamente ESCLUSE

Non progettare, reintrodurre, aprire issue automatiche o creare menu dedicati per:
- **Fisiognomica** (inclusa la galleria di fotografie abbinata).
- **Radionica**.
- **Cosmocentrica**.
- **Chakra / Chakram / petali**.
- **Egizia + Placido** come sistema misto.
- Funzionalità riconoscibili **soltanto** in vecchi menu commentati, disabilitati o prototipi nascosti: per esempio Profezioni, Armoniche, Audio Planet, Moti Sinodici o Sinodi Lunari come moduli autonomi mai attivati, fissaggio di un evento come transito nei vecchi controlli, controlli obsoleti di fullscreen.

La voce **Sinodi** e le sue funzioni effettivamente esposte nell'Ampolla SONO incluse tramite F04/F06; non va confusa con le voci autonome commentate. Per le funzioni esplicitamente richieste qui, la presenza di codice vecchio commentato non prevale sul requisito scritto.

## Tracciabilità, responsabilità e roadmap

| Area | Owner tecnico prevalente | Gate di attivazione |
| --- | --- | --- |
| F01 Archivio/account | Desktop + backend VirgoStars API | schema locale, sync e autorizzazioni |
| F02 Grafici/UX | astrological-charts + desktop Angular | WebGL, fixture sintetiche, UX accessibile |
| F03 Domificazioni, aspetti, punti | VirgoStars-Ephemeris + astrological-functions | matrice metodi, test di parità numerica |
| F04 Eventi | VirgoStars-Ephemeris + astrological-functions + dati eventi | precisione, copertura e ricerca prima/dopo |
| F05 Tecniche e rivoluzioni | astrological-functions + grafici | formule, verifica con fixture note |
| F06 Tecniche tradizionali | astrological-functions + renderer | formule/terminologia documentate |
| F07 Lunazioni e carte eventi | astrological-functions + astronomia canonica | test date/ora/fusi, segno e tipo evento |
| F08 Dati e stelle fisse | Ephemeris + chart + sito VirgoStars | coordinate e deep link verificati |

**Definition of ready per funzionalità:** specifica input/output, contratto del package responsabile, test deterministici e casi limite, asset con diritti verificati, esperienze online/offline, errori gestiti, entrambe le modalità light/dark, accessibilità, e nessuna dipendenza segreta dal vecchio software. Lo stato passa da “previsto” a “integrato” solo dopo evidenza verificabile in app; non marcare checkbox su base documentale.

## Fonti e controllo versioni

- Requisiti di prodotto approvati il 2026-11-10.
- [Swiss Ephemeris — programming interface, elenco ufficiale domificazioni](https://www.astro.com/swisseph/swephprg.htm), usato come **target di compatibilità funzionale**, non come codice da incorporare o copiare.
- La documentazione dei repository upstream è autorevole per le **capacità realmente implementate**; questo catalogo descrive le funzioni future della workstation.
