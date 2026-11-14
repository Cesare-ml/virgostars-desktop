# Ricerca offline delle località

Il comando Tauri `search_offline_places` apre in sola lettura la risorsa fissa `places/world-cities.sqlite`. Non accetta percorsi o SQL dal frontend; restituisce al massimo 30 risultati e limita a due le ricerche contemporanee. Le coordinate sono espresse in microgradi e il fuso è un identificativo IANA, non un offset storico calcolato.

Il selettore in Parametri ritarda le richieste, ignora risultati obsoleti e supporta la tastiera. Mostra un errore esplicito se la risorsa manca o l'app è aperta nel browser. La selezione rimane in memoria: non viene salvata e non cambia il grafico sintetico. Non sono implementati il calcolo astronomico reale, l'archivio delle carte o la risoluzione storica del tempo.

La build standard rimane priva di dati privati. Per includere il catalogo usare l'overlay verificato descritto in [Catalogo offline](LOCAL_CITY_PACKAGING.md). Prima di dichiarare la funzione pronta occorre collaudare la build con risorsa in Windows WebView2 e verificare le condizioni di distribuzione del catalogo.


## Fail-closed TypeScript/native IPC boundary

The Angular-side `OfflinePlaceSearch` rejects queries containing fewer than two Unicode letters/digits or more than 80 Unicode code points **before** invoking Tauri. This mirrors the bounded Rust input gate (Rust alone builds the fixed FTS5 query; the WebView never constructs SQL). A response containing more results than the explicit requested limit is rejected, even though the protocol-wide maximum remains 30.

Only the exact Rust rejection strings `PLACE_SEARCH_BUSY` and `PLACE_CATALOG_UNAVAILABLE` are converted into recognizable UI statuses; arbitrary rejected objects are never passed through `String(error)` or printed. Other errors become a generic unavailable status. Late responses are still discarded when `clear()`, `dispose()`, or a newer search invalidates their generation.

Synthetic regression coverage: `tests/offline-place-ipc-boundaries.test.mjs` exercises international and astral Unicode, 80/81 code-point bounds, over-limit native replies, hostile error objects, exact error-code mapping, and cancellation order. These checks do not prove the licensed catalog, native Windows IPC or the GUI works; run the full suite and a Tauri/WebView2 smoke test before merging.
