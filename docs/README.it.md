# VirgoStars Desktop — panoramica italiana

**Stato al 10 novembre 2026:** repository privato, progetto documentale; nessuna applicazione desktop o installer implementato. La licenza open source sarà scelta in un secondo momento.

## Scelta dei linguaggi
La combinazione proposta è **TypeScript + Angular** per l'interfaccia, **Rust** per le funzionalità native e il riuso di VirgoStars-Ephemeris, **Tauri 2** per l'applicazione desktop, **SQLite** per il database offline e **Three.js** tramite astrological-charts per le carte astrologiche. Non scegliamo Python o C# come linguaggio principale perché richiederebbero di riscrivere parti già esistenti; Python rimane possibile per strumenti esterni e contributi scientifici.

Questa è una **scelta proposta**, da validare con una prima demo Windows 11 che renderizzi realmente un grafico e faccia una chiamata Rust nativa. Se emergono blocchi fondamentali, valutare Electron con misure e test documentati.

## Funzionamento
**VirgoStars Desktop funziona fin dal primo avvio senza account e senza Internet.** L'utente può scegliere una città dal catalogo offline, vedere il cielo attuale e l'orologio, correggere data/ora con pulsanti anche tenuti premuti, creare/salvare/cercare temi in un archivio locale e usare transiti, domificazioni, orbite, aspetti e skin Light/Dark quando i rispettivi motori saranno validati. Il login VirgoStars è facoltativo: quando viene attivato, il programma confronta i temi locali e online, propone le alternative in caso di duplicati e sincronizza senza cancellare automaticamente i dati. Cifratura locale preferita per dati personali, ma separata dal requisito di poter usare il programma come ospite.

## Confini tra progetti
VirgoStars-Ephemeris calcola l'astronomia; astrological-functions applica i metodi astrologici; astrological-charts visualizza; astrological-assets ospita risorse approvate; VirgoStars gestisce account e dati online; virgostars-desktop unisce i componenti senza sostituire i sistemi in produzione. VirgoStars-Event-Ephemeris potrà fornire eventi astronomici precomputati quando sarà pronto.

## Distribuzione e licenza
Windows prima, macOS successivamente. Aggiornamenti dell'app firmati e verificati, rilascio manuale iniziale senza GitHub Actions. Codice destinato a diventare pubblico e gratuito ma **licenza ancora non scelta**. Gli obblighi CPAL-1.0 dei progetti che la usano vanno rispettati anche in un'app con una diversa licenza. Gli asset non diventano automaticamente pubblicabili.

## Leggi
- [Decisione linguaggi e framework](ADR-0001-TECH-STACK.md)
- [Architettura](ARCHITECTURE.md)
- [Login e sincronizzazione offline](OFFLINE_AUTH_AND_SYNC.md)
- [Sicurezza](SECURITY_AND_PRIVACY.md)
- [Aggiornamenti](UPDATES_AND_DISTRIBUTION.md)
- [Licenza](LICENSING_AND_PUBLICATION.md)
- [Roadmap](ROADMAP.md)
- [Istruzioni agenti](../AGENTS.md)

## Priorità approvate 11/11/2026

- [MVP offline senza account](OFFLINE_FIRST_MVP.md)
- [Performance e comunicazione Angular–Rust](LIVE_CALCULATION_PIPELINE.md)
- [Città offline, fusi e ora legale](OFFLINE_PLACES_AND_TIMEZONES.md)
- [Sincronizzazione facoltativa e gestione duplicati](OPTIONAL_SYNC_AND_DUPLICATES.md)
- [Roadmap e compiti per gli agenti](ROADMAP.md)

La presenza di queste specifiche non significa che le funzioni siano già implementate nel prototipo Windows.
