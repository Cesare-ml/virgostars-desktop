# Croce monomerica — integrazione desktop (prototype)

La schermata del tema ora espone il pulsante **Croce** accanto alle viste
**Elementi** e **Aspetti**. La vista usa il componente Angular di
`astrological-charts` e la geometria di
`astrological-functions/monomeric-cross`. Legge le sette longitudini
tradizionali e le cuspidi della domificazione attiva dal tema già calcolato;
non fa nuove chiamate al server o al runtime nativo e non salva dati.

**Limiti espliciti:** il Maestro dell'Ora è scelto manualmente e non viene
dedotto dalla data di nascita; il catalogo di immagini tebaiche non è ancora
collegato, né è stata approvata la convenzione di numerazione storica.
Di conseguenza la vista mostra correttamente quattro punti, case e governatori,
ma non afferma di fornire un'interpretazione astrologica completa.

Prima della release: integrare alba/tramonto sorgente-verificati con il
`PlanetaryHoursSchedule` esistente; approvare il catalogo e i diritti sui
testi; test di render desktop Windows, macOS, mobilità dello zoom e stampa.
Un vecchio PDF personale non va copiato nei test di repository.

Rollback: rimuovere il pulsante e la presentazione `monomeric-cross`, senza
modificare il WebGL lifecycle della ruota. Nessun cambiamento ad auth, sync,
privacy, update, IPC o asset originali.
