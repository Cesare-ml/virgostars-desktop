# Cielo 3D — sfera completa e lente fisheye (20 novembre 2026)

**Stato:** implementazione proposta su branch dedicato, non integrata in `main` e non ancora collaudata sul runtime nativo Windows/WebView2.

## Obiettivo

Raggiungere navigando con mouse e rotellina le inquadrature *all-sky* viste in Stellarium: orizzonte come circonferenza, volta celeste fino al nadir, superficie del terreno circolare quando visibile, meridiano completo sopra e sotto l'orizzonte. Il modello grafico resta originale VirgoStars; nessun codice, texture, catalogo o interfaccia di Stellarium è stato copiato.

## Due regimi collegati da una transizione continua

- **28–84°:** prospettiva standard Three.js, qualità dei glifi conservata nel rendering diretto.
- **Da 85°:** attivazione del campionamento cubico delle sei direzioni celesti. Alla soglia di 85° la proiezione del nuovo shader è matematicamente uguale alla prospettiva, senza salto geometrico.
- **85–120°:** interpolazione continua del raggio angolare dalla proiezione prospettica `atan(r * tan(FOV/2))` alla proiezione *equidistante* `r * FOV/2`. Il fattore è un smoothstep, zero a 85° e uno a 120°.
- **120–220°:** fisheye equidistante, adatto a vedere una semisfera intera e oltre 180° per comprendere anche la relazione fra cielo e terreno. Non è una lente fotografica calibrata; è una proiezione didattica della sfera.
- **«Tutto il cielo»:** impostazione rapida a 200° con puntamento allo zenit. I pulsanti per zenit e nadir sono separati e la rotellina continua ad agire sul campo visivo.
- **Trascinamento:** non si ferma a ±85°: la camera ruota stabilmente oltre zenit e nadir senza il classico problema di `lookAt` al polo. Il puntamento dell'HUD è convertito nell'altezza/azimut reali della direzione osservata.

## Coordinate e accuratezza

Il bridge Rust/DE441 e il contratto `altitudeDeg/azimuthNorthEastDeg` restano **identici**. Ogni posizione planetaria e stellare è quella già validata dal motore astronomico nel suo attuale campo di supporto; solo la proiezione grafica cambia.

La rappresentazione `observerVector` precedente esponeva X=Est/Y=Alto/Z=Nord, un insieme che, se applicato direttamente al mondo destrorso di Three.js, invertiva la percezione geografica. Questa modifica usa esplicitamente:

- X positivo = Est;
- Y positivo = Zenit;
- Z positivo = Sud (il Nord è Z negativo).

Il nuovo `skyCameraFrame` fornisce una base ortonormale destrorsa anche ai poli, mentre `skyFisheyeWorldRay` ricostruisce la direzione usata dal click scegliendo esattamente la stessa formula angolare dello shader. L'equatore celeste è aggiornato alla stessa convenzione. La selezione di oggetti nascosti sotto il terreno viene impedita quando il terreno è attivo.

## Prestazioni

`SkyDomeLens` usa un `WebGLCubeRenderTarget` di **1024×1024 per faccia** e una `CubeCamera` con sei direzioni. L'aggiornamento delle sei facce avviene soltanto quando cambiano le geometrie/livelli o arrivano nuove coordinate astronomiche. Drag, zoom e ridimensionamento riutilizzano il cubemap già pronto e rendono soltanto un quad shader con il nuovo orientamento: non richiamano le effemeridi e non ricostruiscono sei viste per ogni movimento.

Sotto 85° la scena usa la normale PerspectiveCamera, senza risoluzione cubica limitante. La stessa finestra mantiene un unico canvas WebGL. Lo smontaggio dispone render target, materiali, mesh e listener.

## Meridiano sotterraneo

Il precedente meridiano N→Zenit→S copriva solo 180°. Ora la seconda semicirconferenza S→Nadir→N è tratteggiata e attenuata. Quando il terreno è attivo, questo può occludere la porzione di cerchio sotto l'orizzonte; nascondendo il terreno si vede l'intero circolo.

## Test e limiti

`tests/sky-dome-projection.test.mjs` include:
- Nord/Est/Sud/Ovest nella scena destrorsa;
- base ortonormale per azimut, entrambi i poli e rotazioni oltre ±90°;
- continuità prospettiva/fisheye a 85°, campo fino a 220°;
- raggi di selezione al centro, bordo, zenit e nadir;
- presenza del cache del cubemap e corretta dismissione.

**Ancora da fare, prima della pubblicazione:**

1. Eseguire `node --experimental-strip-types --test tests/sky-dome-projection.test.mjs`, `npm test`, `npm run verify:ipc` e `npm run build:ui` in un checkout completo con le librerie sorelle.
2. Prova nativa Tauri su Windows/WebView2 (GPU base e potente), normal/spherical crossover a 85°, 1024 cubemap, DPR 100–200%, context loss, resize, trasparenza e alpha dei layer.
3. Confrontare in Stellarium e nelle coordinate Rust indipendenti: N/E/S/O, meridiano, ascendente, stelle e pianeti, con campo 60°, 120°, 180° e 220°. Nessuna posizione astronomica è ricalcolata dal renderer.
4. Verificare click/picking in fisheye a tutte le latitudini, inclusi zenit, nadir e orizzonte; test visivo con terreno attivo/disattivo e con Sole sopra/sotto orizzonte.
5. Rivalutare la risoluzione cubemap e la qualità dello shader su GPU con poche risorse prima di estendere alla versione mobile.

Questa funzione non aggiunge un paesaggio realistico o una Via Lattea fotografica: quelli richiederebbero risorse e verifiche separate, e non devono mascherare la precisione astronomica del sistema.


## Rafforzamento del renderer — aggiornamento del 20/11

- Le immagini dei pianeti, i glifi, i nomi delle stelle, le etichette degli angoli e i cardinali ora usano **piani tangenti orientati verso il centro della sfera** (`sky-dome-billboard.ts`) invece di `THREE.Sprite`: l'orientamento rimane costante quando la CubeCamera cambia faccia, riducendo le discontinuità sul fisheye.
- La lente sceglie una risoluzione di **256, 512 o 1024 px per faccia**, in funzione del limite `MAX_CUBE_MAP_TEXTURE_SIZE` dichiarato dalla GPU. L'utente non deve intervenire per adattare il valore.
- Se il cubemap o lo shader falliscono, il rendering fa **fallback alla prospettiva normale ≤84°** invece di impostare un campo >180° su una PerspectiveCamera non adatta. L'interfaccia segnala esplicitamente il limite hardware. Un vero context-loss WebGL resta un errore separato.
- `tests/sky-dome-billboard.test.mjs` verifica orientamento e geometria radiale ai poli e negli ottanti, incluse ancore dei piccoli glifi; i controlli di dimensione/fallback sono inclusi nei test della proiezione.
- **Non ancora verificato su Windows:** continuità della texture, orientamento dei piani nel cubemap, qualità delle immagini e comportamento del fallback su una GPU con limiti reali.

