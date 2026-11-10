# VirgoStars Desktop — domificazioni e compatibilità

Data decisione: 2026-11-10. **Requisito di prodotto, non implementazione pronta.**
Vedi [FEATURE_CATALOG.md](FEATURE_CATALOG.md), requisito F03.01.

## Decisione vincolante

1. **Egizia** è un sistema disponibile autonomamente, da specificare e validare secondo la tradizione di calcolo già adottata dal progetto. Non assumere che coincida con Equal o Whole Sign senza una definizione matematica approvata.
2. **Egizia + Placido** è **esclusa**: nessuna opzione, alias nascosto o sistema misto da migrare.
3. VirgoStars Desktop includerà **l'intero catalogo di metodi di domificazione della Swiss Ephemeris compatibile con la versione di riferimento** tramite il motore originale **VirgoStars-Ephemeris (Rust)**. Non collegare Swiss Ephemeris a runtime e non incorporarne codice/algoritmi coperti da licenza.
4. Il selettore desktop usa i nomi comprensibili, con ID canonici stabili e metadati espliciti; l'alias **A/E** è un unico metodo, mentre versioni alternative (es. Sunshine) devono essere trattate senza ambiguità. Non sostituire automaticamente un sistema in caso di errore.

## Inventario completo dei metodi Swiss di riferimento

L'elenco si basa sui codici documentati nell'interfaccia di programmazione Swiss Ephemeris 2.10. È un **target** di copertura; ogni metodo compare nella UI reale solo dopo implementazione e test nel motore Rust.

| Codice Swiss | Sistema richiesto | Note |
| --- | --- | --- |
| A, E | Equal / Case uguali dall'Ascendente | Due alias dello stesso metodo |
| B | Alcabitius / Alcabitus | |
| C | Campanus | |
| D | Equal MC | Cuspide 10 dal MC |
| F | Carter Poli-Equatorial | |
| G | Settori Gauquelin | **36 settori**, non 12 case |
| H | Orizzontale / Azimutale | |
| I | Sunshine (Makransky / Treindl) | Richiede dati solari e casi limite |
| i | Sunshine (variante Makransky) | Codice/variante soggetti alla versione Swiss di riferimento; verificare semantica e case sensitivity nei test |
| K | Koch | Limitazioni alle latitudini estreme |
| L | Pullen SD (Sinusoidal Delta) | |
| M | Morinus | |
| N | Equal/1 = 0° Ariete | **Non confondere** con Whole Sign ancorato al segno dell'ASC |
| O | Porfirio / Porphyry | |
| P | Placido / Placidus | Limitazioni alle latitudini estreme |
| Q | Pullen SR (Sinusoidal Ratio) | |
| R | Regiomontano / Regiomontanus | |
| S | Sripati | |
| T | Polich/Page Topocentric | |
| U | Krusinski–Pisa–Goelzer | |
| V | Vehlow Equal | ASC al centro della prima casa |
| W | Whole Sign | Prima casa dal segno dell'Ascendente |
| X | Meridian / Axial Rotation | |
| Y | APC | |

**Metodo aggiuntivo VirgoStars:** Egizia (identificatore proprio, non forzato a un codice Swiss). **Esclusione esplicita:** Egizia + Placido.

Le denominazioni storiche “Neo-Porphyry” e “Pisa” sono sinonimi riportati dalla documentazione, non sistemi duplicati. Se la versione di riferimento Swiss viene estesa, aggiornare questa matrice e le prove numeriche prima di dichiarare copertura “tutti i sistemi”.

Fonte ufficiale: https://www.astro.com/swisseph/swephprg.htm (sezione “Houses”, elenco completo e limitazioni); note teoriche: https://www.astro.com/swisseph/swisseph.htm .

## Contratto richiesto tra librerie

- **VirgoStars-Ephemeris (Rust):** unico provider dei calcoli astronomici richiesti e della geometria di domificazione compatibile: cuspidi, angoli, ARMC, informazioni di precisione/stato, errori e casi limite.
- **astrological-functions (TypeScript):** selezione astrologica, etichette, assegnazione e trasformazione di posizioni in case, validazione semantica, composizione dei temi; non ricalcola la geometria astronomica alternativa.
- **astrological-charts (Three.js):** riceve le cuspidi e il tipo di domificazione, mostra le case in modo fedele (distinzione 12/36); non produce cuspidi.
- **VirgoStars Desktop:** presenta scelta sistema, stato supportato/non supportato, note sui metodi e memorizza l'ID del metodo nel tema/preferenze. Usa offline il motore Rust installato e non dipende da API remote di terze parti per un calcolo locale.
- **Sito VirgoStars:** se sincronizza un tema deve ricevere l'identificatore della domificazione e gestire compatibilità delle versioni senza ricostruzioni silenziose.

Contratto minimo suggerito (da formalizzare nel provider): systemId, SwissReferenceCode opzionale, systemVersion, input (istante UTC/TT secondo API, geolat, geolon, flags, obliquità ove richieste), output (cuspidi/settori, ASC, MC, ARMC, altri assi, status/warnings). Non imporre arbitrariamente un array di 12 case al sistema G.

## Accuratezza, errori e casi limite

- Validare gli istanti nel calendario di riferimento, fusi orari e DST all'origine della carta; confrontare input uniformati.
- Verificare casi nell'emisfero nord/sud, longitudini est/ovest, equatore, latitudini temperate e polari.
- Placidus, Koch e Gauquelin hanno limiti di definizione/costruzione in aree polari. Swiss documenta fallback a Porfirio con warning; **nel desktop ogni fallback deve essere esplicito, mai nascosto né presentato con l'etichetta del metodo richiesto**.
- Casi Sunshine possono essere indeterminati quando manca una posizione solare valida; mostrare errore/limitazione anziché inventare cuspidi.
- Affrontare differenze tra cuspide geometrica e posizione del pianeta nella casa, specie con latitudine e declinazione planetaria non nulle.
- Whole Sign e Equal/Aries hanno origine convenzionale diversa. Egizia richiede documento di formula approvato: non basta riconoscere la denominazione.
- Il motore deve dichiarare disponibilità del metodo e motivazione quando mancano algoritmo, dati o test. Non inserire voci di menu falsamente funzionanti.

## Matrice di test obbligatoria

Per **ogni** metodo/codice, documentare:
1. Disponibilità effettiva nella build Rust, con versioning del contratto.
2. Fixture di confronto per identico input con **Swiss Ephemeris come riferimento di test esterno**, mai dipendenza runtime del programma.
3. Confronto cuspidi, ASC, MC, ARMC, eventuali 36 settori e house positions con tolleranze angolari dichiarate e motivate.
4. Controllo di numerazione, orientamento, wrapping 0°/360°, continuità temporale, latitudini estreme e casi limite.
5. Stesso risultato attraverso bridge nativo Rust e/o WASM quando presenti.
6. Rendering del caso test su 12 o 36 settori, etichette coerenti nel tema e nella UI light/dark.
7. Risultato chiaro “supportato”, “non disponibile” o “errore verificato”, senza sostituzioni implicite.

## Sequenza suggerita (priorità di sviluppo, non riduzione scope)

- Gruppo A: Egizia con specifica approvata; Placidus, Regiomontano, Porfirio, Koch; Equal e Whole Sign come metodi distinti.
- Gruppo B: Campanus, Alcabitius, Topocentric, Morinus, Vehlow, Meridian, Equal MC/Aries.
- Gruppo C: tutti gli altri (incluso Gauquelin 36 settori, Pullen SD/SR, Sunshine nelle varianti, APC, Carter, Krusinski, Sripati e Horizontal).

**Done:** nessun metodo può essere marcato completo prima di test numerici, test UI, coverage fallback/casi limite e review del contratto. Questa richiesta estende il perimetro finale, non anticipa la disponibilità delle librerie.
