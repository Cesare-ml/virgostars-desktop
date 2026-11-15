/**
 * Function menu of the desktop workstation, taken from the menus of Regolo
 * Alpha Leonis. Every entry is listed so nothing is forgotten, and each one
 * says truthfully whether it works today.
 *
 *  - `available`: wired to a real calculation or renderer feature in this build.
 *  - `planned`:   in scope, not implemented yet. Shown disabled.
 *  - `excluded`:  present in Regolo but left out by the approved feature scope
 *                 of 2026-11-10. Listed for traceability, never shown as a goal.
 */
export type FunctionStatus = 'available' | 'planned' | 'excluded';

/** What clicking an available entry does. Planned entries have none. */
export type FunctionAction =
  | 'new_chart' | 'session_charts' | 'now_chart' | 'mode_natal' | 'mode_transits'
  | 'mode_synastry' | 'mode_latitude' | 'house_system' | 'planet_info' | 'archive'
  | 'solar_return' | 'lunar_return' | 'aspect_table' | 'chart_settings';

export type FunctionEntry = Readonly<{
  id: string;
  it: string;
  en: string;
  status: FunctionStatus;
  action?: FunctionAction;
}>;

export type FunctionGroup = Readonly<{
  id: string;
  it: string;
  en: string;
  entries: readonly FunctionEntry[];
}>;

const available = (id: string, it: string, en: string, action: FunctionAction): FunctionEntry =>
  Object.freeze({id, it, en, status: 'available', action});
const planned = (id: string, it: string, en: string): FunctionEntry =>
  Object.freeze({id, it, en, status: 'planned'});
const excluded = (id: string, it: string, en: string): FunctionEntry =>
  Object.freeze({id, it, en, status: 'excluded'});
const group = (id: string, it: string, en: string, entries: FunctionEntry[]): FunctionGroup =>
  Object.freeze({id, it, en, entries: Object.freeze(entries)});

export const FUNCTION_CATALOG: readonly FunctionGroup[] = Object.freeze([
  group('charts', 'Temi e archivio', 'Charts and archive', [
    available('new-chart', 'Nuovo Tema', 'New chart', 'new_chart'),
    available('session-charts', 'Temi della sessione', 'Session charts', 'session_charts'),
    available('archive', 'Archivio', 'Archive', 'archive'),
    planned('groups', 'Gruppi', 'Groups'),
    planned('account-chart', 'Tema Account', 'Account chart'),
    planned('default-place', 'Posizione di Default', 'Default place'),
    planned('chart-correction', 'Correzione Tema', 'Chart rectification'),
    planned('unknown-time', 'Orario Sconosciuto', 'Unknown birth time'),
  ]),
  group('time', 'Tempo e transiti', 'Time and transits', [
    available('real-time', 'Tempo reale (adesso)', 'Real time (now)', 'now_chart'),
    available('transits', 'Transiti', 'Transits', 'mode_transits'),
    planned('synods', 'Sinodi', 'Synods'),
    planned('synodic-motion', 'Moto sinodico', 'Synodic motion'),
    planned('ingresses', 'Ingressi', 'Ingresses'),
    planned('saturn-conjunctions', 'Congiunzioni Saturno', 'Saturn conjunctions'),
    planned('text-ephemeris', 'Effemeridi testuali', 'Text ephemeris'),
    planned('graphic-ephemeris', 'Effemeridi grafiche', 'Graphic ephemeris'),
    planned('calendar-conversion', 'Conversione Calendario', 'Calendar conversion'),
  ]),
  group('comparison', 'Confronti e previsioni', 'Comparison and forecasting', [
    available('synastry', 'Sinastrie', 'Synastry', 'mode_synastry'),
    planned('swap-charts', 'Inverti Temi', 'Swap charts'),
    planned('synastry-transits', 'Mostra Transiti in sinastria', 'Transits over synastry'),
    planned('deflective-synastry', 'Sinastria Deflettiva', 'Deflective synastry'),
    available('solar-return', 'Rivoluzione Solare', 'Solar return', 'solar_return'),
    available('lunar-return', 'Rivoluzione Lunare', 'Lunar return', 'lunar_return'),
    planned('return-map', 'Mappa delle rivoluzioni', 'Return relocation map'),
    planned('directions', 'Direzioni', 'Directions'),
  ]),
  group('settings', 'Impostazioni del tema', 'Chart settings', [
    available('house-system', 'Domificazione', 'House system', 'house_system'),
    available('planet-info', 'Info Pianeti', 'Planet information', 'planet_info'),
    available('celestial-elements', 'Elementi Celesti', 'Celestial elements', 'chart_settings'),
    available('aspects', 'Aspetti', 'Aspects', 'aspect_table'),
    available('aspect-direction', 'Aspetti Verso', 'Aspect direction', 'chart_settings'),
    available('planet-orbs', 'Orbite Pianeti', 'Planet orbs', 'chart_settings'),
    available('aspect-orbs', 'Orbite Aspetti', 'Aspect orbs', 'chart_settings'),
    planned('aspect-focus', 'Focus Aspetti', 'Aspect focus'),
    planned('applications', 'Applicazioni (appl./disappl.)', 'Applying and separating'),
    planned('transsaturnians', 'Transaturnini se in congiunzione', 'Trans-Saturnians when conjunct'),
    planned('austral-inversion', 'Inversione Australe', 'Austral inversion'),
    planned('planet-of-year', "Pianeta dell'anno", 'Planet of the year'),
  ]),
  group('traditional', 'Astrologia tradizionale', 'Traditional astrology', [
    planned('dodecatemoria', 'Dodecatemori', 'Dodecatemoria'),
    planned('antiscia', 'Antisci', 'Antiscia'),
    planned('arabic-parts', 'Parti Arabe (Essenziali)', 'Arabic parts (essential)'),
    planned('abu-mashar', "Parti Arabe (Abu Ma'shar)", "Arabic parts (Abu Ma'shar)"),
    planned('custom-parts', 'Parti Arabe (Crea)', 'Arabic parts (custom formula)'),
    planned('kleros', 'Kleros (4 Kleros, 5 Planetarie)', 'Kleros (4 Kleroi, 5 planetary)'),
    planned('lots-view', 'Estrapola e Visualizza Sorti', 'Extract and show lots'),
    planned('monomoiria', 'Monomeri', 'Monomoiria'),
    planned('decades', 'Decadi', 'Decades'),
    planned('decans', 'Decani', 'Decans'),
    planned('terms', 'Termini', 'Terms'),
    planned('planetary-ascensions', 'Ascendenze', 'Planetary ascensions'),
    planned('radix-synods', 'Sinodi Radix', 'Radix synods'),
    planned('fixed-stars', 'Stelle Fisse', 'Fixed stars'),
  ]),
  group('moon', 'Luna, stagioni, oraria ed elettiva', 'Moon, seasons, horary and electional', [
    planned('radix-new-moon', 'Novilunio Radix', 'Radix new moon'),
    planned('radix-apogee', 'Apogeo Radix', 'Radix apogee'),
    planned('hermetic-lunations', 'Lunazioni Ermetiche', 'Hermetic lunations'),
    planned('syzygies', 'Sizigie', 'Syzygies'),
    planned('seasons', 'Stagioni', 'Seasons'),
    planned('planetary-hours', 'Ore Planetarie', 'Planetary hours'),
    planned('horary', 'Erigi Oraria', 'Cast horary chart'),
    planned('electional', 'Erigi Elettiva', 'Cast electional chart'),
  ]),
  group('views', 'Grafici complementari', 'Additional views', [
    available('natal', 'Tema natale', 'Natal chart', 'mode_natal'),
    available('latitudes', 'Latitudini', 'Latitudes', 'mode_latitude'),
    planned('elements', 'Elementi', 'Elements'),
    planned('blackboard', 'Lavagna', 'Blackboard'),
  ]),
  group('excluded', 'Escluse dallo scope approvato', 'Excluded by the approved scope', [
    excluded('physiognomy', 'Fisiognomica', 'Physiognomy'),
    excluded('chakra', 'Chakra', 'Chakra'),
  ]),
]);

export type CatalogSummary = Readonly<{available: number; planned: number; excluded: number}>;

export function summarizeCatalog(catalog: readonly FunctionGroup[] = FUNCTION_CATALOG): CatalogSummary {
  const counts = {available: 0, planned: 0, excluded: 0};
  for (const item of catalog) for (const entry of item.entries) counts[entry.status]++;
  return Object.freeze(counts);
}
