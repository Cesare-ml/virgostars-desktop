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
