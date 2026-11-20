# Cielo 3D — griglia zodiacale e corpi planetari (2026-11-20)

**Stato:** implementato sul branch della PR #393; compilazione Angular/Rust e collaudo grafico Windows/WebView2 ancora da effettuare. Le immagini degli astri sono **illustrazioni originali**, non fotografie NASA o mappe astronomiche certificate.

## Griglia dei segni: dati astronomici, non disegno arbitrario

Il comando nativo `calculate_sky_dome` ora invia anche `zodiacGrid`, generato in Rust con le coordinate e l'obliquità vera dell'istante selezionato. La griglia è costruita nella stessa cornice eclittica tropicale del tracciato già validato:

- bordo settentrionale/superiore **latitudine eclittica +8°**, 361 punti campionati da 0° a 360°;
- bordo meridionale/inferiore **latitudine eclittica −8°**, 361 punti;
- **12 separatori di 30°**, longitudinalmente alle cuspidi dei segni, 9 punti ciascuno da −8° a +8°;
- **24 tacche di 10°/20°**, 5 punti ciascuna, meno intense;
- linea centrale dell'eclittica originale e glifi VirgoStars Assets mantenuti separatamente.

La fascia di ±8° è **una convenzione didattica visuale**, non una divisione del cielo sancita dal motore astronomico. Non va confusa con le case, con una Via Lattea fotometrica o con l'esatta fascia di declinazioni delle costellazioni. Non si inferisce un'interpretazione astrologica né una domificazione dalla fascia.

**Unit test:** cardinali 0° e 360° continui, 12 divisioni principali, 24 divisioni secondarie, coordinate non valide, fallimenti espliciti, separazione dei due bordi. Il decoder TypeScript richiede lunghezze esatte: una risposta tronca non viene visualizzata.

## Corpi planetari: dischi riconoscibili e glifo piccolo

`sky-dome-planet-portraits.ts` genera offline una texture originale per ciascun corpo fisico supportato dal provider (Sole, Luna, Mercurio, Venere, Marte, Giove, Saturno, Urano, Nettuno, Plutone e Chirone). Ogni posizione rimane un singolo punto di osservazione calcolato dal motore Rust. La texture è una **resa didattica** con:

- Sole luminoso e Luna craterizzata;
- Mercurio con superficie grigia craterizzata, Venere dalle tinte atmosferiche, Marte rosso con macchie di albedo;
- Giove con fasce e macchia rossa stilizzate;
- Saturno con fasce e anelli illustrativi; orientamento degli anelli **non** fisicamente calcolato;
- Urano e Nettuno dalle colorazioni atmosferiche indicative; Plutone e Chirone rappresentati graficamente.

Un piccolo simbolo astrologico ufficiale da `astrological-assets` appare come un badge secondario, indipendente dal corpo. Le dimensioni sono deliberate per la leggibilità in 3D e **non** corrispondono a diametri angolari veri. Non si afferma di rappresentare la fase effettiva, la rotazione o l'illuminazione del corpo; per un futuro livello *fotografico reale* servono immagini approvate, crediti/provenienza, packaging offline e un modello appropriato.

Le `CanvasTexture` sono generate soltanto per gli astri realmente ricevuti dal provider, mantenute in una cache del componente e rilasciate al termine. Nessuna richiesta di rete o immagine segnaposto esterna viene introdotta. Se la generazione locale non è disponibile, il corpo mantiene un semplice marker nel suo punto corretto.

## Nomi delle stelle reali

Aggiunto un livello `Nomi stelle`, disattivabile, che etichetta un sottoinsieme limitato delle stelle del catalogo locale: magnitudine non nulla e ≤2.7, deduplicazione per nome e massimo 26 etichette. Non aggiunge stelle o costellazioni fittizie. Se il catalogo locale manca, la UI resta coerente con i dati disponibili.

## Coerenza del meridiano e dell'all-sky

- Meridiano 360° sopra/sotto l'orizzonte implementato nella PR #393.
- Fisheye 85–220° e camera che può attraversare zenit e nadir implementati nello stesso branch.
- Nel frame Three.js destrorso valgono `+X=Est`, `+Y=Zenit`, `+Z=Sud` (Nord = −Z). Anche la vecchia funzione `observerVector` è stata riallineata a questa convenzione, e il test di orientamento è aggiornato.

## QA e limiti prima del merge

1. `npm test`, `npm run verify:ipc`, `npm run build:ui`, `cargo test` e `cargo check` su un checkout completo con dipendenze e kernel disponibili.
2. Confronto altazimutale e della griglia zodiacale con Stellarium/astronomia indipendente, tenendo uguali data, coordinate, correzioni e convenzioni.
3. Prova delle texture dei pianeti su Windows/WebView2 a 28°, 75°, 120°, 180° e 220°; verificare che glifo piccolo, anello di Saturno e marker selezionato siano visibili senza sovrapposizioni.
4. Controllare i livelli `Griglia segni` e `Nomi stelle`, prestazioni del cubemap, gestione asincrona dei glifi, resize/context loss e memoria GPU.
5. Verificare CSS responsive: pannelli, dock dei pianeti, pulsanti «Tutto il cielo», «Zenit», «Nadir», e controlli a schermi piccoli.
6. Prima di definire i pianeti «fotografici», integrare immagini NASA/JPL o di altre fonti con approvazione espressa della licenza, attributi e pacchetto offline. L'implementazione attuale non incorpora fotografie astronomiche.

Nessuna GitHub Action eseguita dal branch in questo passaggio.


## Ricerca offline nelle stelle fisse — aggiornamento del 20/11

- Aggiunta al pannello una ricerca testuale **per nome** sulle sole stelle ricevute dal comando Rust per il luogo e l'istante attivi.
- `sky-dome-star-search.ts` cerca senza connessione, con confronto case/accent-insensitive, input massimo 60 caratteri e massimo sette risultati mostrati, ordinando prima nomi esatti e prefissi, poi magnitudine.
- Selezionare un risultato ruota la camera verso l'altezza/azimut reale e apre la scheda dell'astro. Per le stelle sotto l'orizzonte, con il terreno attivo viene indicato come mostrare la direzione nascosta.
- Nessuna posizione stellare viene stimata o generata dal frontend; l'assenza di un catalogo reale rimane dichiarata e non viene colmata con stelle decorative.
- `tests/sky-dome-star-search.test.mjs` aggiunge casi di ricerca, sicurezza e appartenenza al catalogo. Alcune verifiche isolate della ricerca sono state eseguite con Node 22, **non** una compilazione completa del Desktop.

