# Cielo 3D — illuminazione geometrica di Luna e pianeti

**Stato: prototipo.** I calcoli sono implementati nel branch della PR #397, ma `cargo test`, `npm test`, la compilazione Angular/Tauri e il collaudo Windows/WebView2 non sono stati completati in questa sessione.

## Perché serve la geometria Sole–corpo–Terra

Un'unica `DirectionalLight` della scena orientata verso il Sole *osservato dalla Terra* non può illuminare correttamente allo stesso tempo Mercurio, Venere, Luna e pianeti esterni: ciascuno riceve la luce da una direzione differente.

La prima iterazione aveva già aggiunto la percentuale illuminata della Luna tramite le posizioni native. Questa iterazione estende **lo stesso calcolo geometrico** a tutti i corpi non solari e trasmette anche la direzione specifica che *da quel corpo* punta al Sole, nel sistema altazimutale dell'osservatore.

## Calcolo nel motore Rust

`BodyPositionV1` del provider astronomico contiene ascensione retta, declinazione apparente geocentrica e distanza Terra-corpo in unità astronomiche.

Si costruiscono i vettori geocentrici `S` (Terra→Sole) e `P` (Terra→pianeta), nelle medesime coordinate equatoriali di data:

- corpo→Sole: `L = S − P`
- corpo→Terra: `E = −P`
- angolo di fase: `cos(i) = dot(L,E) / (|L|×|E|)`
- frazione illuminata vista da Terra: `k = (1 + cos(i)) / 2`

Il vettore `L` è normalizzato e convertito nell'altazimut della stessa cornice astronomica usata per il cielo. Il provider restituisce `illuminatedFraction` (0–1) e `sunlightDirection` (altitudine/azimut). I campi sono `null` per il Sole e per le stelle; nessun campo è simulato se distanza, coordinate o direzione non sono valide.

Il decoder Angular richiede che **i due campi siano presenti insieme** e che abbiano range finiti, e rifiuta la loro presenza sul Sole o sulle stelle. Le coordinate originali di ogni astro restano inalterate.

### Test geometrici da eseguire

I test Rust verificano:
- Luna nuova ideale: 0% e plenilunio ideale: 100%;
- quarto lunare: circa 50%;
- Venere in congiunzione **inferiore** (tra Terra e Sole): illuminazione circa 0%;
- Venere in congiunzione **superiore** (oltre il Sole): illuminazione circa 100%;
- caso di Mercurio parzialmente illuminato e direzioni astronomiche finite alle diverse latitudini;
- distanze nulle e input non finiti falliscono senza inventare dati.

Sono presenti inoltre test Node per il contratto, il rendering e il materiale WebGL. L'esistenza dei test non implica che siano stati eseguiti in un ambiente di build completo.

## Materiale grafico delle sfere

`sky-dome-solar-material.ts` modifica il materiale integrato `THREE.MeshBasicMaterial` per **ogni globo con fotografia**, con un normale verso l'esterno nel mondo 3D e una uniforme `uSkySunDir` propria.

Il terminatore usa `dot(normalWorld,sunDirection)` e una transizione di pochi gradi, lasciando il lato notturno leggibile al 6,5%: è una scelta di rappresentazione grafica, **non** un modello di luce riflessa né di fotometria calibrata.

La rotazione della sfera e la sua texture rimangono approssimative: mancano i veri poli/meridiani centrali delle superfici, le librazioni, l'orientamento fisico degli anelli di Saturno, le eclissi e la rifrazione. La percentuale `k` è una frazione **geometrica geocentrica** e non include topocentrismo, ostruzioni o effetti di luminosità.

La sorgente dati resta VirgoStars-Ephemeris; il frontend **non** calcola nuove orbite o posizioni astronomiche. Le mappe Solar System Scope sono opzionali e si scaricano esplicitamente in una build privata con attribuzione CC BY 4.0. Senza foto, i ritratti grafici originali sono intenzionalmente illustrativi e non presentano un terminatore astronomico.

## QA aperta

- `cargo test` e `cargo check` con provider e kernel disponibili;
- `npm test`, `npm run verify:ipc` e `npm run build:ui` con le dipendenze Angular/Three.js;
- resa dei globi in WebView2/Windows ai campi 75°, 120°, 180° e 220°;
- screenshot/benchmark indipendenti per Luna/Venere/Mercurio in varie fasi;
- validazione del materiale WebGL su macchine senza texture opzionali.

**Non pubblicare una release basata solo sui controlli statici.**
