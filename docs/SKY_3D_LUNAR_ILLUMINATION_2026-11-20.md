# Cielo 3D — illuminazione solare e frazione illuminata della Luna

**Stato: prototipo su branch di QA; non ancora compilato né collaudato in Windows/WebView2.**

## Quale problema risolve

Il cielo 3D precedente posizionava il punto di luce del materiale planetario a
coordinate arbitrarie (`-45,+65,-40`) e utilizzava un'intensità ambientale alta.
Questo produceva un disco della Luna quasi sempre completamente illuminato,
anche quando le effemeridi collocavano Sole e Luna in direzioni incompatibili con
quell'aspetto.

La nuova implementazione collega la sorgente luminosa alla **direzione topocentrica
reale del Sole** calcolata per il luogo e l'istante del tema, mentre la Luna riceve
un nuovo dato `illuminatedFraction` da Rust.

## Calcolo in Rust

I dati `BodyPositionV1` del provider forniscono l'ascensione retta, la
declinazione apparente geocentrica e la distanza Terra-corpo in unità
astronomiche sia per Sole sia per Luna.

Le due direzioni vengono trasformate in vettori cartesiani geocentrici
`S` e `M`, preservando i valori e l'epoca del provider.

La direzione Luna→Sole è `S − M`; la direzione Luna→Terra è `−M`.
L'angolo di fase `i` è l'angolo tra questi due vettori e la frazione
illuminata viene ricavata dalla geometria:

```text
k = (1 + cos(i)) / 2
```

`k` vale zero per Luna nuova ideale e uno per Luna piena ideale. Per il
quarto è vicino a 0,5. Input non finiti, distanze non positive o vettori
degeneri producono `None`: **mai una fase simulata nel browser**.

Il protocollo dell'osservatorio trasmette `illuminatedFraction` soltanto
per `Moon`; stelle e altri pianeti ricevono `null`. Il decoder Angular
richiede un numero finito nell'intervallo [0,1] e rifiuta valori su altri
corpi. La scheda Luna mostra la percentuale con un decimale e l'avviso che
si tratta di una stima geometrica.

## Renderer fotografico

Nel renderer Three.js la sorgente `DirectionalLight` ora è orientata ogni
volta verso il Sole effettivamente restituito dal calcolo astronomico.
L'illuminazione ambientale ridotta lascia distinguere il terminatore delle
sfere fotografico-testurizzate, con un leggero schiarimento della parte
non illuminata per consentire la lettura del corpo.

La fase grafica è tuttora una **approssimazione prospettica**:
- la posizione del sole proviene dal vettore topocentrico dell'osservatore,
  mentre una simulazione rigorosa richiederebbe il vettore corpo→Sole;
- la piccola distanza relativa Luna–Terra giustifica questa approssimazione
  soprattutto per la Luna, ma non per le fasi degli altri pianeti;
- manca il modello fisico di librazione e rotazione lunare, orientamento
  degli anelli di Saturno, diametero angolare, estinzione, rifrazione e
  fotometria;
- i ritratti Canvas illustrativi usati senza texture reali mantengono
  un aspetto non fotometrico.

Per questi motivi **solo la percentuale lunare** è presentata come dato
calcolato (stima geometrica); non viene dichiarata una simulazione precisa
delle fasi degli altri pianeti.

## Test e QA

Aggiunte prove Rust per Luna nuova, plenilunio, quarto e input
non validi. Aggiunti test del decoder TypeScript per range [0,1] e per il
vincolo che il dato sia presente soltanto sulla Luna, più controlli
dell'illuminazione nel renderer e della scheda.

**Ancora da verificare**: `cargo test`, `npm test`, build Angular/Tauri,
WebView2 su Windows e confronto visuale con un planetario indipendente.
La disponibilità delle mappe Solar System Scope è opzionale e continua a
dipendere dal download esplicito prima della build privata; la provenienza e
l'attribuzione delle mappe sono documentate separatamente in
`SKY_3D_REAL_PLANETS_HOUSE_GRID_2026-11-20.md`.
