# RFC — Cielo 3D: archi delle case e vere direzioni primarie

**Stato:** design tecnico, 20 novembre 2026. **Non implementato.** Questo documento distingue astronomia osservabile e costruzioni astrologiche simboliche, evitando rappresentazioni tridimensionali fuorvianti.

## Punto di partenza

Il renderer `Cielo 3D` visualizza ora coordinate altazimutali topocentriche dei corpi e un'eclittica tropicale costruita da valori reali del motore Rust. Il punto di vista è quello dell'osservatore alla data, ora e luogo selezionati. Il terreno può essere nascosto, mantenendo visibili anche le direzioni sotto l'orizzonte.

L'estensione didattica non deve trasformare il renderer in un secondo motore astrologico. Le geometrie vengono **calcolate fuori dalla WebView**, annotate con convenzione e provenienza, poi disegnate senza ricalcolarle.

## 1. Archi e confini dei dodici segni

**Già in corso nella PR #390:** 12 archi continui da 30° di longitudine eclittica tropicale di data, campionati in Rust, con glifi asset originali e punti ASC/DSC/MC/IC.

Estensioni future:
- arco completo di ciascun segno, nome, gradi 0–30 e punti di ingresso;
- opzione didattica di distinguere la *banda* zodiacale dalla sola eclittica (definire latitudine/zona prima di costruire una superficie);
- intersezioni con orizzonte e meridiano: levata e culminazione dei gradi; prospetto numerico con coordinate effettive;
- eventuali zodiaci diversi dal tropicale richiedono **una definizione esplicita** di origine e precessione/ayanamsha. Nessuna trasformazione implicita.

## 2. Geometrie delle case

Non disegnare per nessuna domificazione dodici spicchi di azimut da 30°. I confini delle case dipendono dalla **famiglia del metodo**:

- case uguali/eclittiche: in primo luogo suddivisione della **longitudine eclittica** rispetto all'Ascendente, non dodici piani verticali;
- Regiomontano e Campano: costruzioni geometriche basate su equatore, primo verticale, meridiani e relativi cerchi; ricostruire i piani dalla definizione matematica, non dalla sola longitudine delle cuspidi;
- Placidus/Koch e altri metodi temporali: calcoli dei semiarchi e condizioni di definizione; una cuspide eclittica *da sola* non determina automaticamente l'intera curva spaziale della superficie di casa.

### Contratto proposto

`HouseSkyGeometryV1` (output Rust/calcolo):
- `methodId`, `methodVersion`, `observer`, `epoch`, `frame`;
- `available` / `reason` se geometria non definita, specialmente alle latitudini polari;
- `cusps`: fino a 12 punti di intersezione *con l'eclittica*, con longitudine e posizione nella sfera;
- `boundaries`: 12 curve `altitude/azimuth` **solo dove matematicamente definite** dal metodo;
- `constructionGuides`: linee di meridiano, equatore, primo verticale e semiarchi con prove di provenienza.

**Gate:** verificare ogni curva contro la costruzione matematica della domificazione scelta. Per metodi che definiscono solo cuspidi eclittiche, mostrare solo punti di cuspide fino a specifica approvata per i confini tridimensionali.

## 3. Vere direzioni primarie

La direzione primaria descrive un arco ricavato dal moto diurno **sulla sfera di riferimento natale**, non lo spostamento fisico dei pianeti verso una data futura. La funzione moderna `SIMPLIFIED_PRIMARY` del Desktop non deve ricevere l'etichetta «direzioni primarie vere».

Richiedere esplicitamente prima dell'implementazione:
1. scuola/metodo di direzione (ad esempio tolemaico, Placido o Regiomontano), geometria mondana/zodiacale, con o senza latitudine;
2. significatore e promittore, punto di aspetto, direzione diretta/conversa, relazione sopra/sotto orizzonte;
3. scelta di piano di proiezione, semiarchi, polo, ascensione retta/obliqua e regole dei punti circumpolari;
4. chiave arco→tempo (equatoriale, tolemaica, Naibod, ecc.) e calendario; `ageYears` non è un dato astronomico osservato;
5. gestione di ΔT, calendario storico, precessione e disponibilità delle effemeridi.

### Contratto proposto

`PrimaryDirectionGeometryV1`:
- `natalFrame`: osservatore, epoca, convenzioni delle coordinate;
- `method`: identificativo/versione, coefficienti/parametri, promittore/significatore;
- `geometry`: semiarco, cerchio/polo di direzione, posizione iniziale/finale e curva dell'arco sulla sfera;
- `result`: arcogradi, diretta/conversa, eventuale conversione temporale con `keyId` e incertezza se nota;
- `evidence`: riferimenti tecnici, valori intermedi riproducibili, confronto con casi pubblicati;
- `status`: computed/unavailable/undefined; niente dati sintetici.

Il renderer 3D mostrerà il moto geometrico su una sfera **fissa alla nascita** con indicazione di `arco di direzione`, non altererà il cielo astronomico reale né chiamerà queste posizioni “transiti”.

## 4. Distribuzione delle responsabilità

- **VirgoStars-Ephemeris (Rust):** istanti e coordinate astronomiche, sistemi di riferimento, rotazione, moto diurno, cielo osservato.
- **astrological-functions:** definizione dei metodi di domificazione e di direzione, archi e conversioni astrologiche, test di dottrina.
- **VirgoStars Desktop:** orchestrazione, selezione di tema/metodo, gestione UI, persistenza eventuale delle preferenze.
- **Three.js:** disegno delle curve già validate, controlli e interazioni.

Non copiare codice Stellarium: è solo un possibile riferimento esterno di confronto per il cielo osservato.

## 5. Test di accettazione

1. Equatore, orizzonte, meridiano, eclittica, ASC e MC coincidono in 3D con i risultati documentati e le convenzioni dei calcoli 2D.
2. Gli archi zodiacali restano contigui fra 359° e 0°, anche ai poli e al passaggio allo zenit, confrontando i vettori e non gli azimut singolari.
3. La geometria delle case cambia per Placidus/Campano/Regiomontano secondo i metodi, non soltanto cambiando etichetta.
4. Ogni direzione primaria conserva inputs, passaggi intermedi, arcogradi e chiave temporale; confronto di casi indipendenti prima di attivare la UI.
5. Dataset mancanti, sistemi non definiti e convenzioni storiche incerte interrompono il calcolo oppure restituiscono uno stato esplicito: nessun fallback silenzioso.
6. Performance e accessibilità: livello disattivabile, zoom leggibile, indicazione dei piani geometrici, controlli via tastiera, liberi da dati personali remoti.

## Ordine di sviluppo proposto

1. Collaudare PR #390 su Windows/WebView2 con DE441 e correggere anomalie.
2. Mostrare cuspidi eclittiche già calcolate con indicazione della domificazione, **senza inferire una superficie di casa**.
3. Implementare una sola geometria completa di domificazione, validarla e generalizzare il contratto.
4. Specificare e validare un metodo preciso di direzioni primarie vere in `astrological-functions`; solo allora attivare l'overlay tridimensionale.
