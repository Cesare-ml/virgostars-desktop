# Ricerca offline delle località

Il comando Tauri `search_offline_places` apre in sola lettura la risorsa fissa `places/world-cities.sqlite`. Non accetta percorsi o SQL dal frontend; restituisce al massimo 30 risultati e limita a due le ricerche contemporanee. Le coordinate sono espresse in microgradi e il fuso è un identificativo IANA, non un offset storico calcolato.

Il selettore in Parametri ritarda le richieste, ignora risultati obsoleti e supporta la tastiera. Mostra un errore esplicito se la risorsa manca o l'app è aperta nel browser. La selezione rimane in memoria: non viene salvata e non cambia il grafico sintetico. Non sono implementati il calcolo astronomico reale, l'archivio delle carte o la risoluzione storica del tempo.

La build standard rimane priva di dati privati. Per includere il catalogo usare l'overlay verificato descritto in [Catalogo offline](LOCAL_CITY_PACKAGING.md). Prima di dichiarare la funzione pronta occorre collaudare la build con risorsa in Windows WebView2 e verificare le condizioni di distribuzione del catalogo.

## Temporary selection: clear and disambiguation (prototype)

The Settings inspector now provides a keyboard-focusable **Clear location** action for an explicitly selected offline place, with Italian and English labels. The selection summary also displays available region, country and IANA time-zone metadata to distinguish places that share a name. Missing metadata is omitted rather than invented. The original native result ID and coordinates remain in memory only while selected.

Clearing invalidates the pending debounce/native lookup generation, removes suggestions, clears the query and temporary selected record, and notifies the parent inspector so reopening the tab cannot silently restore the previous city. A late native response cannot undo this action. Neither choosing nor clearing a city writes a database, starts a network request, resolves historical time zones or changes synthetic chart positions.

Synthetic Node regressions are in `tests/offline-city-selection.test.mjs`. Runtime/manual acceptance still requires compiling the Angular application and checking keyboard/focus, narrow window layout, clearing followed by inspector close/reopen, and real offline search under Windows Tauri/WebView2 with a licensed catalog installed.
