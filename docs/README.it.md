# VirgoStars Desktop — panoramica italiana

**Stato al 12 novembre 2026:** codice prototipale Angular/Tauri in preparazione per la pubblicazione; licenza CPAL-1.0 scelta per il codice originale. Esiste una prova di avvio Windows, ma non una release di produzione.

## Scelta dei linguaggi
La combinazione proposta è **TypeScript + Angular** per l'interfaccia, **Rust** per le funzionalità native e il riuso di VirgoStars-Ephemeris, **Tauri 2** per l'applicazione desktop, **SQLite** per il database offline e **Three.js** tramite astrological-charts per le carte astrologiche. Non scegliamo Python o C# come linguaggio principale perché richiederebbero di riscrivere parti già esistenti; Python rimane possibile per strumenti esterni e contributi scientifici.

Questa è una **scelta proposta**, da validare con una prima demo Windows 11 che renderizzi realmente un grafico e faccia una chiamata Rust nativa. Se emergono blocchi fondamentali, valutare Electron con misure e test documentati.

## Funzionamento
Al primo utilizzo l'utente si autentica online con il proprio account VirgoStars. I soggetti e i temi consentiti vengono memorizzati localmente in forma protetta. Nei successivi avvii senza Internet può continuare a lavorare con dati e calcoli disponibili; le modifiche restano in coda e si sincronizzano automaticamente al ritorno della connessione. Conflitti e revoche richiedono regole esplicite.

## Confini tra progetti
VirgoStars-Ephemeris calcola l'astronomia; astrological-functions applica i metodi astrologici; astrological-charts visualizza; astrological-assets ospita risorse approvate; VirgoStars gestisce account e dati online; virgostars-desktop unisce i componenti senza sostituire i sistemi in produzione. VirgoStars-Event-Ephemeris potrà fornire eventi astronomici precomputati quando sarà pronto.

## Distribuzione e licenza
Windows prima, macOS successivamente. Aggiornamenti dell'app firmati e verificati, rilascio manuale iniziale senza GitHub Actions. Codice originale sotto **CPAL-1.0** con attribuzione VirgoStars; vedere [LICENSE](../LICENSE) e [NOTICE](../NOTICE). Gli asset e il catalogo delle città non diventano automaticamente pubblicabili. La visibilità GitHub resta privata finché non sono completati i controlli prepubblicazione.

## Leggi
- [Decisione linguaggi e framework](ADR-0001-TECH-STACK.md)
- [Architettura](ARCHITECTURE.md)
- [Login e sincronizzazione offline](OFFLINE_AUTH_AND_SYNC.md)
- [Sicurezza](SECURITY_AND_PRIVACY.md)
- [Aggiornamenti](UPDATES_AND_DISTRIBUTION.md)
- [Licenza](LICENSING_AND_PUBLICATION.md)
- [Roadmap](ROADMAP.md)
- [Istruzioni agenti](../AGENTS.md)
