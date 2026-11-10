# VirgoStars Desktop — stelle fisse e collegamento alle interpretazioni web

**Decisione di prodotto:** 2026-11-10. **Stato: progettazione, integrazione NON presente.**
Requisiti funzionali: [FEATURE_CATALOG.md](FEATURE_CATALOG.md), F08.09–F08.10.

## Obiettivo

VirgoStars Desktop deve avere la visualizzazione e la ricerca delle **stelle fisse nel grafico astrologico**, ma la fonte autorevole delle **interpretazioni delle stelle fisse** resta il **database / sito VirgoStars**. Da una stella selezionata nel desktop si deve poter **aprire la corrispondente pagina di approfondimento sul sito** (nel browser di sistema). La UI può presentare dati astronomici essenziali e una sintesi solo se proveniente da un contratto ufficiale/approvato; non creare una seconda banca dati interpretativa nel programma desktop.

## Separazione delle fonti

- **VirgoStars-Ephemeris (Rust):** identificativi astronomici e dati astronomici verificati delle stelle supportate (nome/catalogo, coordinate/epoca/velocità o trasformazioni, magnitudine e distanza ove disponibili). Non produrre interpretazioni.
- **astrological-functions:** associazione degli identificativi stella al tema, filtri astrologici, aspetti/congiunzioni ove specificati e verificati. Non duplicare il catalogo delle interpretazioni.
- **astrological-charts:** render delle stelle e selezione/hover/focus, anti-collisione, visualizzazione dei dettagli del punto.
- **VirgoStars online:** fonte autorevole per nome editoriale, traduzioni, contenuti interpretativi e **URL canonico** della scheda, gestiti dal backend/website.
- **Desktop:** connettore leggero per risolvere l'ID di stella in una destinazione web e aprirla in modo sicuro.

## UX desiderata

1. Attivare/disattivare il livello **Stelle fisse** e cercare/selezionare una stella.
2. Mostrare nome, identificativo, magnitudine, coordinate (longitudine/latitudine, eventualmente azimut, altitudine e distanza) quando i dati sono effettivamente calcolabili.
3. Inserire nell'ispettore la voce **“Leggi interpretazione su VirgoStars”** / **“Apri scheda online”** collegata alla stella selezionata.
4. Con Internet e URL confermato dal sito, aprire la pagina nel **browser predefinito del sistema operativo**, non in un iframe che duplichi il sito.
5. Se il contenuto richiede login, l'autorizzazione avviene **sul sito**, senza trasferire token desktop nel link, nell'URL o nei log.
6. In assenza di Internet le coordinate/stelle già disponibili tramite l'ephemeris locale restano consultabili; mostrare “interpretazione disponibile online quando torni connesso” e non inventare testi.
7. URL non disponibile, stella non mappata, pagina rimossa o errore 404: presentare una spiegazione comprensibile e un link di ricerca al sito **solo se supportato dal contratto**.

## Contratto backend proposto (nessun endpoint presunto già esistente)

L'interfaccia tecnica precisa si concorda con il repository del sito VirgoStars. Un risultato tipizzato di risoluzione di una stella dovrebbe includere:
- Identificatore astronomico stabile e/o alias/catalog ID.
- Identificatore editoriale/canonico del database interpretativo.
- Nome display e lingua opzionale.
- URL HTTPS **canonico fornito dal servizio VirgoStars**, con eventuale flag pubblico/riservato.
- Versione del mapping e indicazione “non trovato” senza far ricadere la selezione su una stella dal nome simile.

Non inventare indirizzi, slug, API o parametri di autenticazione. Evitare di includere data di nascita, coordinate del soggetto e identità account nei parametri del link. Prima dell'apertura verificare l'origin HTTPS con allowlist configurata e validata per il dominio VirgoStars ufficiale.

## Aspetti offline e sincronizzazione

- L'app non richiede Internet per mostrare **posizioni delle stelle supportate dal motore locale**.
- È ammesso memorizzare una piccola cache di **mapping ID → URL canonico** e metadati non sensibili, con invalidazione/versioning. Non sincronizzare automaticamente il testo delle interpretazioni né copiare il database editoriale.
- Quando offline, link non verificabili possono essere mostrati come non disponibili; evitare che URL vecchi diventino una pretesa di collegamento valido.
- Usare preferenze lingua/account coerenti, senza rendere la lettura online un requisito per l'apertura del tema.
- Se la pagina è riservata, lasciare che il sito gestisca accessi, permessi, abbonamenti e sessioni.

## Test e condizioni di accettazione

- [ ] Almeno una stella di prova sintetica/dimostrativa ha mapping ID esatto e risolve un URL canonico restituito dal mock del servizio.
- [ ] Selezione nel grafico → dettaglio → apertura browser di sistema su dominio allowlist.
- [ ] URL non valido, host esterno, schema non HTTPS e redirect non consentiti vengono rifiutati o gestiti esplicitamente.
- [ ] I link non contengono token o dati del tema.
- [ ] Assenza rete e mancata corrispondenza editoriale sono stati distinti, senza contenuti inventati.
- [ ] Test con nomi alternativi, omonimie e identificativi non risolti; nessuna associazione per somiglianza automatica.
- [ ] I testi restano gestiti sul sito VirgoStars e non sono duplicati negli asset o nel repository desktop.
- [ ] Le schede delle stelle nel tema si adattano a light/dark, navigazione tastiera e screen reader.

**Nota di stato:** il database web interpretativo e le sue API reali vanno verificati/contrattualizzati in una successiva attività sul repository di VirgoStars. Questo documento non autorizza modifiche automatiche a backend, sito, dati o permessi.
