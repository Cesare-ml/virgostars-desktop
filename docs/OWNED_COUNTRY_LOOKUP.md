# Associazione degli stati

`stato_id` è la chiave della tabella stati originale, non un codice ISO. Il convertitore importa una mappatura esplicita e rifiuta ID duplicati, codici non validi e associazioni mancanti. Per gli export senza intestazione `--source-export` legge `id,nome,nome_it,iso2` e conserva entrambi i nomi. Il contratto di ricerca v2 restituisce il nome originale e il codice ISO; i vecchi cataloghi v1 senza mappatura rimangono leggibili. Non dedurre mai un paese dal valore numerico dell'ID.

Vedere [Catalogo offline](LOCAL_CITY_PACKAGING.md).
