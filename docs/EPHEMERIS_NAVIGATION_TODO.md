# Desktop: navigazione delle effemeridi

**Stato: da progettare e implementare.** Il pannello tecnico «Pianeti storici» non è una funzionalità di prodotto. Il nuovo strumento dovrà offrire una navigazione accessibile delle effemeridi, ispirata alle schermate Regolo fornite dal proprietario il 18 novembre 2026. Gli screenshot sono riferimenti funzionali, non un requisito di copiarne marchi, grafica o dati.

- **Vista tabellare:** scelta di corpo celeste, data e ora iniziali e passo (ore o giorni); righe navigabili con data/ora, longitudine zodiacale, latitudine, velocità e distanza, con unità chiare e formattazione corretta.
- **Vista grafica:** ruota dello zodiaco con corpi e aspetti disponibili; controlli per spostarsi avanti e indietro nel tempo con passo selezionabile e scegliere quali corpi mostrare. Riutilizzare `astrological-charts` e gli asset approvati.
- **Comportamento:** indicare chiaramente il riferimento temporale e i dati non disponibili; nessun calcolo inventato o conversione storica implicita. Le due viste dovrebbero usare lo stesso istante e il motore VirgoStars-Ephemeris, senza esporre parametri tecnici come requisito per la navigazione ordinaria.
- **Da definire nel progetto:** navigazione e prestazioni su intervalli ampi, impostazioni e accuratezza delle date storiche, accessibilità, disponibilità del file DE441, gestione dei limiti e percorso di integrazione nel tema completo.

Nessuna delle due viste è implementata da questo documento. I bridge diagnostici preesistenti restano codice interno e non costituiscono l'interfaccia finale.
