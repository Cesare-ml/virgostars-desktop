# Ricerca offline delle località

Il comando Tauri `search_offline_places` apre in sola lettura la risorsa fissa `places/world-cities.sqlite`. Non accetta percorsi o SQL dal frontend; restituisce al massimo 30 risultati e limita a due le ricerche contemporanee. Le coordinate sono espresse in microgradi e il fuso è un identificativo IANA, non un offset storico calcolato.

Il selettore in Parametri ritarda le richieste, ignora risultati obsoleti e supporta la tastiera. Mostra un errore esplicito se la risorsa manca o l'app è aperta nel browser. La selezione rimane in memoria: non viene salvata e non cambia il grafico sintetico. Non sono implementati il calcolo astronomico reale, l'archivio delle carte o la risoluzione storica del tempo.

La build standard rimane priva di dati privati. Per includere il catalogo usare l'overlay verificato descritto in [Catalogo offline](LOCAL_CITY_PACKAGING.md). Prima di dichiarare la funzione pronta occorre collaudare la build con risorsa in Windows WebView2 e verificare le condizioni di distribuzione del catalogo.

Il parser FTS5 nativo ignora i frammenti di un solo carattere (per esempio `L` in `L'Aquila`), per evitare ricerche con prefissi estremamente ampi su milioni di località. Richiede almeno un termine di due caratteri e accetta al massimo cinque termini significativi: sei o più termini restituiscono `PLACE_QUERY_INVALID` invece di ignorare silenziosamente le parole finali. Gli identificatori non vengono mai trattati come sintassi FTS arbitraria: le parole ricercabili vengono racchiuse tra virgolette e usate solo come prefissi. Questo è un limite di sicurezza/prestazioni, non una normalizzazione astronomica o geocodifica.
