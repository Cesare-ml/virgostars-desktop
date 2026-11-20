# Proiezioni zodiacali nel desktop

Il pannello del tema natale offre **Dodecatemori**, **Antisci** e **Contrantisci**, con selezione di tutti o di uno dei sette pianeti tradizionali presenti e visibili. Le tre proiezioni sono alternative fra loro. I Monomeri possono essere attivati insieme ai dodecatemori: puntando un punto proiettato si usa la sua longitudine, mentre il punto natale conserva il proprio monomero. Gli antiscî e contrantiscî consentono di scegliere l'asse cardinale, fisso o mutevole, come nel sito VirgoStars.

Il desktop riceve le posizioni dal provider astronomico. I dodecatemori sono già prodotti dall'adattatore tramite `dodecatemoriaLongitude` di `astrological-functions`, secondo il metodo ×13 del progetto. Per le riflessioni usa le funzioni condivise di normalizzazione e distanza angolare, con assi di Regolo a 270°, 300° e 330°; il contrantiscio è opposto all'antiscio. I punti non calcolati o nascosti non sono aggiunti. Il renderer riceve posizioni già calcolate e disegna solo le proiezioni.

La modalità singola dei dodecatemori mette in evidenza gli aspetti del punto proiettato; per antiscî e contrantiscî sono disegnate le geometrie del sito, senza inventare nuovi aspetti. I glifi usano `astrological-assets`. Le opzioni sono temporanee e il PNG viene generato con la proiezione attiva. La validazione locale con dati sintetici non equivale a una verifica scientifica indipendente o a un collaudo WebView2 su dati reali.

Con le stelle fisse attive, le congiunzioni in longitudine ai dodecatemori
visibili si aggiungono a quelle del radix e vengono indicate separatamente nella
scheda. Si usano la longitudine effettiva della stella, il limite di magnitudine
e la distanza in longitudine scelti dall'utente; i contatti della stella con gli
assi restano quelli fisici del luogo, non una proiezione degli assi. Cambiare il
pianeta selezionato limita i contatti ai dodecatemori disegnati.
