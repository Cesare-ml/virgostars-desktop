# Icone dei sei strumenti complementari

Le icone SVG sono disponibili in `design/menu-icons/`. Usano un `viewBox` di 24 × 24, tratto vettoriale monocromatico con `stroke="currentColor"`, estremi arrotondati e nessuna dipendenza esterna. Funzionano sia sul tema chiaro che su quello scuro.

| Voce italiana | Nome in `vs-menu-icon` | Simbolo |
| --- | --- | --- |
| Ascendenze | `planetary-ascensions` | Corpo celeste che sale sopra l'orizzonte |
| Sinodi radix | `radix-synods` | Dischi Sole-Luna in una ruota |
| Ore planetarie | `planetary-hours` | Orologio e corpo celeste |
| Stagioni | `seasons` | Ruota solare divisa in quattro |
| Chakra | `chakra` | Sette centri allineati |
| Apogeo radix | `radix-apogee` | Orbita ellittica e apogeo lunare |

In una voce della toolbar Angular inserire l'icona prima del testo:

```html
<vs-menu-icon name="planetary-hours"></vs-menu-icon>
```

Il componente `vs-menu-icon` è già usato dal Desktop per Monomeri e rivoluzioni. Le icone sono puramente visuali: **questa modifica non implementa le sei funzioni**, non ne cambia lo stato nel catalogo e non introduce pulsanti non funzionanti. Nella versione attuale di `main` le sei voci mostrate nello screenshot non compaiono ancora nel markup della toolbar; il collegamento ai pulsanti effettivi potrà essere effettuato quando quel markup viene integrato.
