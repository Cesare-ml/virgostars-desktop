# Cielo 3D · cambio livelli senza ricaricare i pianeti

**Prototipo, 21 novembre 2026.** Modifica UI/renderer isolata, nessuna modifica alle effemeridi, al provider o ai dati dell'utente. Implementata nella PR dedicata e non ancora integrata in `main`.

## Problema verificato

Prima di questo intervento, i tre pulsanti «Pianeti», «Stelle» e «Nomi stelle» chiamavano tutti `buildMarkers()`. La funzione **rimuoveva e smaltiva ogni mesh e ogni texture del gruppo**, quindi anche un semplice clic su «Nomi stelle» avviava nuovamente il caricamento/decodifica delle texture dei pianeti (comprese le mappe JPEG Solar System Scope, quando presenti). Era una ricostruzione superflua potenzialmente costosa soprattutto su WebView2 e con la proiezione sferica a sei facce.

## Implementazione

`sky-dome.component.ts` organizza ora gli oggetti del Cielo 3D in tre sottogruppi persistenti:

- **`planetMarkerGroup`** — sfere e ritratti planetari, piccoli glifi astrologici, bagliori e anello illustrativo di Saturno;
- **`starPointGroup`** — stelle autentiche ottenute dal provider, raggruppate per luminosità;
- **`starLabelGroup`** — piani tangenti con i nomi delle stelle del catalogo realmente disponibile, senza etichette inventate.

I tre controlli agiscono solo sulle proprietà `visible`. `buildMarkers()` continua a fare un vero smontaggio/ricostruzione **esclusivamente quando cambia la risposta astronomica** (istante, luogo o stato di calcolo), con i controlli di generazione asincrona già presenti e la liberazione delle texture.

Quando cambiano le opzioni visuali:
1. la geometria e le texture rimangono in memoria;
2. il cubemap viene invalidato per riflettere la visibilità dei gruppi, ma non vengono ricreati i materiali o rilanciati i caricamenti fotografici;
3. le selezioni non più visibili vengono chiuse correttamente; il terreno può chiudere una scheda selezionata sotto l'orizzonte.

## Selezione delle stelle

I nomi delle stelle sono diventati cliccabili: ogni piano della label contiene il riferimento alla **stella originale** fornita da Rust e viene inserito tra i target del raycaster.

`sky-dome-marker-layers.ts` applica una politica comune di visibilità e di selezione. Poiché Raycaster può intercettare oggetti appartenenti a gruppi invisibili, il controllo **esclude esplicitamente**:
- stelle quando «Stelle» è disattivato;
- nomi delle stelle quando «Nomi stelle» è disattivato, pur consentendo il clic sul puntino della stella;
- pianeti quando «Pianeti» è disattivato.

Nessuna posizione, magnitudine o attributo astronomico viene calcolato nel nuovo helper.

## Test e collaudi

`tests/sky-dome-marker-layers.test.mjs` copre tutte le otto combinazioni dei tre toggle, l'indipendenza dei gruppi, l'interazione con l'elenco delle stelle, la selezione sui nomi e il fatto che i pulsanti non richiamino `buildMarkers()`.

Il modulo isolato `sky-dome-marker-layers.ts` è stato verificato anche in una copia locale con **TypeScript 5.8.3** (strict, noEmit) e **Node 22.16.0**: due test della logica delle combinazioni e selezione sono passati. Queste prove **non** certificano una build Angular né un rendering WebGL.

**Da verificare prima di una release:** `npm test`, `npm run build:ui:private`, `cargo check/test` e soprattutto un collaudo Windows/WebView2 con mappe reali: cliccare ripetutamente «Stelle»/«Nomi stelle»/«Pianeti», osservare il traffico GPU e accertarsi che le immagini non vengano scaricate/decodificate nuovamente. Non è stata avviata alcuna GitHub Action automatica.


## Rifinitura del picking stellare (21/11 — iterazione successiva)

Il raycaster Three.js `THREE.Points` misura la tolleranza in **unità del mondo 3D**. La soglia precedente, `1.6` indipendentemente dalla camera, produceva una zona cliccabile sproporzionata nelle viste ingrandite (es. FOV 28°) e troppo ristretta nelle viste grandangolari (es. 220°).

Il nuovo helper puro `src/app/sky-dome-star-picking.ts` converte un obiettivo di **6 pixel CSS** in una tolleranza angolare calcolata dalla *stessa* funzione `skyLensTheta` usata dal renderer fisheye e dal picking. Considera **altezza effettiva del canvas**, FOV e posizione radiale del cursore: calcola sia la variazione angolare radiale sia quella perpendicolare, e usa il valore maggiore. Il raggio del cielo resta convenzionalmente 100 unità, mentre la tolleranza è limitata a 0,2–3,25 unità per sicurezza.

Esempi numerici isolati (altezza 800 px, raggio relativo dello schermo 0,5):

| FOV | Tolleranza di selezione | Comportamento |
|---|---:|---|
| 28° | circa 0,37 unità | Clic più preciso negli zoom stretti |
| 85° | circa 1,25 unità | Continuità col passaggio alla lente fisheye |
| 180° | circa 2,36 unità | Target più facile nel fisheye esteso |
| 220° | circa 2,88 unità | Target calibrato sulla vista completa |

L'helper riceve la funzione di proiezione come parametro: in questo modo non introduce import runtime circolari e può essere testato separatamente, mantenendo **un'unica formula astronomicamente neutra** per il disegno e la selezione.

Aggiunto `tests/sky-dome-star-picking.test.mjs`: verifica il comportamento ai FOV da 28° a 220°, la dipendenza dalla dimensione della finestra, i limiti della lente, gli input non finiti e l'integrazione con il raycaster reale.

**Verifica eseguita in questa iterazione:** 5 test del nuovo helper e 5 test preesistenti sui livelli e sulla selezione sono passati in un runtime V8 isolato, eseguendo il contenuto effettivo recuperato da GitHub dopo rimozione minima delle annotazioni TypeScript. Non equivale a `npm test`, `ng build` o a una prova GPU; tali test rimangono da effettuare nel checkout nativo, soprattutto il pixel picking su Windows/WebView2.
