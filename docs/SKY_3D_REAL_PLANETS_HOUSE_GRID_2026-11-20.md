# VirgoStars Desktop · Cielo 3D — immagini planetarie e griglia delle case
**Prototipo, 20 novembre 2026 — branch di sviluppo. Non ancora collaudato su Windows/WebView2 né approvato per il rilascio.**

## Cosa comprende questa implementazione

1. Atmosfera e sfumature del cielo disattivabili. In assenza di atmosfera l'app mostra lo sfondo scuro senza modificare alcuna coordinata celeste; non è un modello fisico di estinzione o rifrazione.
2. Menu riorganizzati in sezioni richiudibili: **Geometria**, **Aspetto del cielo** e **Ricerca stelle**. Le funzioni sono indipendenti (meridiano, griglia, segni, cuspidi, stelle, glifi, atmosfera, terreno).
3. Scheda approfondita cliccando un astro: altezza/azimut, longitudine/latitudine eclittica, segno e glifo ufficiale, ascensione retta e declinazione quando realmente disponibili, distanza geocentrica, velocità in longitudine, magnitudine, costellazione, identificativo e origine delle effemeridi. I campi non forniti non vengono inventati né mostrati.
4. Griglia delle **cuspidi delle case realmente calcolate per la domificazione selezionata**. Ogni cuspide viene proiettata sull'eclittica di data e tracciata nella banda didattica ±8° di latitudine eclittica (9 punti). Le etichette I–XII sono poste al punto intermedio tra due cuspidi reali successive. Il selettore è sincronizzato con quello del tema nel Desktop.
5. Pianeti con **mappe di superficie reali o ricostruite da dati NASA/JPL**, ottenibili dalle texture originali Solar System Scope, quando l'utente esegue un download esplicito. La resa è una sfera testurizzata, con illuminazione visiva e glifo astrologico piccolo. Senza texture scaricate rimangono i ritratti grafici originali.

## Domificazione: limite geometrico dichiarato

Le cuspidi dipendono dal metodo (`egizia`, `placido`, `koch`, `regio-montano`, `porfirio`) e vengono restituite dal modulo Rust già utilizzato per il grafico. La selezione attiva non viene convertita né sostituita da un sistema disponibile diverso.

La griglia è una **proiezione dei dodici punti di cuspide e dei settori zodiacali sull'eclittica**: è utile per insegnare dove i segni e le case si incontrano, ma **non è la superficie geometrica completa delle case nel cielo tridimensionale**. Non sarebbe corretto ottenere quelle superfici prendendo dodici semplici piani a 30° in azimut; servirà la costruzione specifica della domificazione. Il progetto per queste superfici resta [SKY_3D_HOUSES_PRIMARY_DIRECTIONS_RFC.md](SKY_3D_HOUSES_PRIMARY_DIRECTIONS_RFC.md).

Per metodi non disponibili per l'istante/latitudine (ad esempio casi polari), la griglia non viene simulata. Il provider risponde solo per sistemi con cuspidi calcolabili.

## Sorgente, diritti e correttezza delle immagini

- **Fornitore immagini:** Solar System Scope, https://www.solarsystemscope.com/textures/
- **Licenza delle texture:** Creative Commons Attribution 4.0 International, https://creativecommons.org/licenses/by/4.0/
- **Attribuzione richiesta:** © Solar System Scope — CC BY 4.0 (presente nel Cielo 3D, nella build con mappe, e in questo documento).
- La stessa fonte precisa che le mappe rappresentano superfici basate su immagini e dati NASA ma possono presentare zone non ancora mappate ricostruite graficamente e colori volutamente più saturi. **Non costituiscono un'immagine osservativa o fotometrica dell'istante scelto.**
- L'illuminazione, la rotazione della sfera, la fase, l'orientamento degli anelli di Saturno e i diametri apparenti **non sono ancora risultati di un modello astronomico 3D**. La *posizione del centro* di ogni astro deriva dal provider Rust, la texture è visiva.
- Sorgenti disponibili nel download: Sole, Luna, Mercurio, Venere (atmosfera), Marte, Giove, Saturno, Urano e Nettuno. Plutone e Chirone conservano il ritratto grafico finché non siano individuate mappe consentite e scientificamente appropriate.
- Nessuna immagine o codice di Stellarium è copiato. Nessun logo NASA o Solarsystemscope è inserito negli asset.

## Come attivare le mappe offline

Nel checkout del **branch di questa PR**, eseguire una sola volta:

```bash
npm run sky3d:textures:download
```

Il comando tenta di scaricare le nove mappe JPEG dall'origine ufficiale (solo HTTPS e URL allowlisted), controlla tipo, firma JPEG e dimensione, e registra hash SHA-256 in `.local/sky3d/textures/manifest.json`. Se qualche mappa non è disponibile, il comando dichiara l'assenza e mantiene le altre immagini verificate: per il corpo mancante il renderer utilizza il ritratto illustrato. Questo percorso è ignorato da Git; non contiene dati utente.

Successivamente aprire l'app nativa nel modo abituale (`npm run tauri:dev`). Per le build private `prepare:frontend:private` esegue `sky3d:textures:stage`, che verifica gli hash e produce un modulo TypeScript **interno e compilato** con le immagini in formato data URI: la WebView non richiede rete durante il funzionamento. Una build pubblica/sintetica usa il modulo predefinito vuoto e non scarica automaticamente materiali di terzi.

Se la cache non esiste, lo staging scrive un modulo vuoto e il cielo mantiene gli attuali ritratti grafici. Una cache alterata viene rifiutata esplicitamente. Per rifare il download, rieseguire il comando opzionale. La presenza di una mappa nel bundle è indipendente dalla disponibilità delle effemeridi.

**Nota sulle dimensioni:** le mappe sono 2K e sono incorporate nel JS del bundle privato per rispettare gli allowlist esistenti di Tauri e della verifica offline. In futuro potranno diventare un pacchetto di immagini separato, con hash e dichiarazione del fornitore, senza modificare il contratto di calcolo.

## Contratti e sicurezza

- Rust: `SkyDomeV1.houseGrids`, restituisce una griglia per sistema supportato. `HorizontalObject` aggiunge metadati reali provenienti da `BodyPositionV1` e `FixedStarV1`.
- TypeScript: il decoder valida numeri finiti, array bounded e metodi senza duplicati; nulla viene calcolato dal browser per stimare la posizione degli astri.
- UI: controlli per atmosfera, case e domificazione, dettagli selezione. Assenza di fotografie per un pianeta non altera l'accuratezza della sua posizione.
- Il download esplicito richiede una connessione e non ha accesso ad account, archivio dei temi, autorizzazioni Tauri o dati personali.
- Senza download volontario le build non incorporano automaticamente immagini CC BY 4.0.

## Test ancora richiesti prima del merge/release

1. `npm test`, `npm run verify:ipc`, `npm run verify:translations`, `npm run build:ui`, `npm run build:ui:private` e `cargo check/test` con kernel DE441.
2. Visualizzazione reale su Windows/WebView2 con e senza mappe: zoom fisheye 85°–220°, marker selezionati, menu responsive, disattivazione atmosfera e terreno.
3. Riscontro delle 12 cuspidi di tutte le domificazioni e cambi di luogo/latitudine con il tema bidimensionale.
4. Sorgente delle immagini: corretta attribuzione, esistenza dei nove URL, hash, peso del bundle offline e qualità dei colori/rilievi.
5. Test su hardware grafico limitato e verifica dell'assenza di fetch di rete dalla WebView per i pianeti.

Questo documento descrive il codice introdotto, **non certifica un risultato scientifico o una build Windows completata**.
