# Effemeridi Desktop — progetto

Stato: **proposta, non implementata**. Le immagini Regolo mostrano una tabella
per un singolo corpo e una ruota navigabile senza case; sono riferimenti di
funzionamento, non una prova che le corrispondenti funzioni siano già disponibili
in Desktop. Non serve un tema natale per consultare le effemeridi.

## Esperienza proposta

Una voce «Effemeridi» nel menu sinistro apre una schermata autonoma con due viste:

- **Tabella**: data e ora iniziali, corpo celeste e passo (1 h, 12 h, 1 g, 7 g,
  30 g); righe successive con data e ora, longitudine zodiacale, velocità in
  longitudine, latitudine, velocità in latitudine e distanza. Mostrare le unità
  nelle intestazioni, il moto retrogrado con il segno della velocità e i valori
  indisponibili come tali, mai come zero. Caricare le righe a pagine, con comandi
  avanti/indietro e indicazione del periodo visualizzato.
- **Grafico**: ruota zodiacale senza case né ascendente, posizione dei corpi e
  aspetti, selezione dei corpi visibili, data e ora modificabili anche da
  tastiera, passo configurabile e comandi indietro/avanti. Le date e i corpi
  selezionati rimangono coerenti passando da una vista all'altra; la tabella
  usa un corpo scelto, il grafico può mostrarne più d'uno. L'eventuale creazione
  di un tema elettivo è un'azione esplicita distinta dalla consultazione.

Come impostazione iniziale, mostrare l'ora locale della città di riferimento,
coerentemente con «Naviga cielo», con possibilità di passare a UTC chiaramente
indicata in entrambe le viste. L'istante calcolato è unico: cambiare etichetta
di fuso non deve cambiare le posizioni. Per periodi storici nei quali la
conversione civile è incerta o UTC non è una descrizione storicamente propria,
riusare i modelli temporali del motore, senza inventare conversioni: individuare
e validare la convenzione applicabile prima di rendere disponibile quel periodo.
Non chiedere all'utente di selezionare un modello astronomico.

La disponibilità dipende dagli archivi installati e dai corpi effettivamente
supportati dal motore. Al limite del pacchetto, conservare la vista e offrire il
collegamento a Impostazioni → Applicazione per ampliare le date, se possibile.
Non introdurre un limite arbitrario 1900–2033. La copertura dichiarata dal
pacchetto non garantisce da sola la disponibilità di ogni singolo modello.

## Integrazione tecnica proposta

- Il contratto attuale `calculate_chart` calcola un singolo istante **con**
  coordinate e case; include longitudine, latitudine, distanza e velocità.
  `calculate_historical_chart` ha una richiesta temporale distinta. Non sono
  un endpoint di tabella a pagine né una garanzia di copertura uniforme.
- Introdurre un comando Tauri versionato e limitato per una pagina di campioni
  geocentrici, con corpo, istante iniziale, passo e numero massimo di righe.
  Calcoli e conversioni restano nel motore Rust; Angular valida la risposta e
  non ricalcola le posizioni. Gestire risultati parziali, corpi indisponibili,
  errori distinti e invalidazione delle richieste superate. Valutare riuso del
  provider e accesso efficiente ai file DE441 senza riaprire il kernel per
  ogni riga; misurare il tempo di esecuzione prima di fissare le dimensioni.
- Il renderer condiviso contiene opzioni `mostraEffemeridi`,
  `effemeridiGrafiche` ed `effemeridiGrafichePianetiAttivi`. Verificare con
  fixture sintetiche e immagini approvate che producano la ruota richiesta,
  senza case e senza dipendere da dati di un tema. La loro presenza nel codice
  non prova che l'integrazione Desktop funzioni già.
- Riutilizzare i controlli e le protezioni del navigatore, il selettore della
  città di riferimento, le impostazioni degli aspetti e il lifecycle del canvas.
  La modalità effemeridi conserva uno stato temporale proprio, senza alterare il
  tema attivo o i dati salvati. Lavorare offline una volta installati i dati.

## Verifiche prima della consegna

Confrontare tabella e grafico sugli stessi istanti e corpi; verificare passi,
fusi, transizioni ora legale, retrogradazioni, latitudine e unità. Coprire date
storiche e future, estremi dei pacchetti, corpi mancanti, richieste rapide,
risposte obsolete e riapertura della schermata. Confrontare campioni con una
fonte astronomica indipendente e verificare la ruota con dati sintetici e con
asset approvati. Infine provare l'interazione in WebView2 e le prestazioni con
gli archivi reali. Una build riuscita non equivale a una validazione numerica.
