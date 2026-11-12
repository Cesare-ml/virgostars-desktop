# Correzione CSS Angular e Tauri

**Stato: testato localmente su Windows 11 / WebView2.** La build precedente generava un collegamento al foglio di stile con `media="print"` e un gestore `onload` inline. La policy Tauri `script-src 'self'` blocca gli script inline: il foglio non diventava attivo nello schermo e la UI appariva senza stili.

La build Angular disabilita `optimization.styles.inlineCritical`, mantiene la minificazione e produce un normale `<link rel="stylesheet" href="styles.css">`. La CSP resta invariata. Il controllo di bundle rifiuta fogli differiti per la stampa o con gestori inline incompatibili.

Verifica locale: 97 test Node e 7 test Rust superati; build Angular, controllo CSS e compilazione Tauri completati. In una finestra Windows/WebView2 della build di sviluppo sono stati verificati layout, tema chiaro e scuro, grafico sintetico e ricerca locale di Firenze. Le immagini dimostrative sono asset sintetici. Queste verifiche non dimostrano il funzionamento degli installer precedentemente generati, che vanno ricompilati.

Per ricostruire il progetto, seguire [Shell 001](SHELL-001.md); per includere il catalogo offline seguire [Catalogo offline](LOCAL_CITY_PACKAGING.md). Eseguire `npm run build:ui` e `npm run verify:css` prima di compilare Tauri; verificare nella finestra nativa che lo stile sia applicato.
