/** Traditional descriptions of the numbered sectors. */
const DESCRIPTIONS:Readonly<Record<string,readonly string[]>> = {
  Vishuddha:[
    'Regolazione della tiroide','Capacità uditive',"Relazione con l’etere; alimentazione sottile",
    'Potenziale espressivo (padronanza del suono)','Senso dell’autorevolezza personale',
    'Capacità di sottomissione o di ribellione','Tasso della generosità interiore','Livello di autocensura',
    'Padronanza dell’attività mentale e capacità di immagazzinamento della memoria','Livello del bisogno di controllare',
    'Creatività globale, ingegnosità','Bisogno di attirare','Controllo dei desideri','Senso di equità / intransigenza',
    'Capacità di discernimento','Decisionalità',
  ],
  Anahata:[
    'Timo, carisma potenziale','Senso del tatto','Aria, capacità respiratoria','Abilità manuale',
    'Empatia, compassione','Senso di condivisione / livello dell’egoismo','Capacità artistiche',
    'Grado dell’egocentrismo','Capacità di impegnarsi personalmente','Potenziale affettivo, sensibilità',
    'Potenziale di abnegazione','Sensualità',
  ],
  Manipura:[
    'Pancreas, potenziale delle difese naturali','Vista','Controllo dell’evacuazione degli escrementi',
    'Fuoco (forza fisica, resistenza)','Capacità di trovare risorse','Combattività',
    'Senso di proprietà o di appartenenza (famiglia, clan, ecc.)','Bisogno delle abitudini e livello di compulsività',
    'Rancore','Gelosia',
  ],
  Muladhara:[
    'Surreni; tasso di memorizzazione cellulare (stoccaggio)','Acutezza del gusto','Capacità di concretizzazione',
    'Circolazione dell’elemento acqua','Abilità nel prendere posizione, nell’entrare in relazione con gli altri',
    'Equilibrio fisico (vertigine o stabilità)',
  ],
  Swadhisthana:[
    'Regola l’attività delle ghiandole e dei testicoli','Capacità olfattive, pulsioni sessuali',
    'Forza sessuale, affermazione della personalità egoica','Rapporto con la terra, radicamento',
  ],
};

export function chakraSectorDescription(chakra:string,sector:number):string|null {
  return Number.isInteger(sector) && sector>0 ? DESCRIPTIONS[chakra]?.[sector-1] ?? null : null;
}
