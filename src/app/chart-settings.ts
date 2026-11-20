/**
 * Chart display settings: which aspects are drawn and with what orbs, and which
 * points are shown and take part in aspects. Device-only preferences with no
 * personal data. The defaults are the ones Regolo Alpha Leonis starts with.
 */
export type AspectKind = 'longitude' | 'directed' | 'parallel' | 'contraparallel';

export type AspectDefinition = Readonly<{id: string; angleDeg: number | null; kind: AspectKind}>;

/** Order used in lists; ids are the keys the Charts renderer expects. */
export const ASPECT_DEFINITIONS = Object.freeze([
  {id: 'congiunzione', angleDeg: 0, kind: 'longitude'},
  {id: 'opposizione', angleDeg: 180, kind: 'longitude'},
  {id: 'trigono', angleDeg: 120, kind: 'longitude'},
  {id: 'quadrato', angleDeg: 90, kind: 'longitude'},
  {id: 'sestile', angleDeg: 60, kind: 'longitude'},
  {id: 'quinconce', angleDeg: 150, kind: 'longitude'},
  {id: 'semisestile', angleDeg: 30, kind: 'longitude'},
  {id: 'semiquadrato', angleDeg: 45, kind: 'longitude'},
  {id: 'quintile', angleDeg: 72, kind: 'longitude'},
  {id: 'biquintile', angleDeg: 144, kind: 'longitude'},
  {id: 'semiquintile', angleDeg: 36, kind: 'longitude'},
  {id: 'novile', angleDeg: 40, kind: 'longitude'},
  {id: 'settile', angleDeg: 51.42, kind: 'longitude'},
  // The two Phi aspects follow the order of the signs: second point ahead of the first.
  {id: 'phisolare', angleDeg: 222.49, kind: 'directed'},
  {id: 'philunare', angleDeg: 137.5, kind: 'directed'},
  {id: 'parallelodideclinazione', angleDeg: null, kind: 'parallel'},
  {id: 'antiparallelo', angleDeg: null, kind: 'contraparallel'},
] as const satisfies readonly AspectDefinition[]);
export type AspectId = typeof ASPECT_DEFINITIONS[number]['id'];

/** Points offered in the settings, in display order. Axes come last. */
export const POINT_IDS = Object.freeze([
  'Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto', 'Chiron',
  'true Node', 'true Node Sud', 'mean Node', 'mean Node Sud',
  'osc. Apogee', 'osc. Perigee', 'mean Apogee', 'mean Perigee',
  'AS', 'MC', 'DS', 'IC',
] as const);
export type PointId = typeof POINT_IDS[number];
export const AXIS_IDS: readonly string[] = Object.freeze(['AS', 'MC', 'DS', 'IC']);

export type AspectSetting = {active: boolean; orb: number | null};
export type PointSetting = {shown: boolean; orb: number; aspects: boolean};
export type FixedStarSettings = {magnitudeLimit: number | null; includeUnknownMagnitude: boolean; longitudeOrb: number; axisOrb: number};
export type ChartSettings = {
  showAspects: boolean;
  australInversion: boolean;
  outerWhenConjunct: boolean;
  planetOfYear: boolean;
  focusAspects: boolean;
  applicationMode: 'off' | 'applying' | 'separating';
  showDecans: boolean;
  showDecades: boolean;
  showTerms: boolean;
  fixedStars: FixedStarSettings;
  aspects: Record<AspectId, AspectSetting>;
  points: Record<PointId, PointSetting>;
};

export const MAX_ORB_DEG = 15;
const DEFAULT_POINT_ORB = 6;
const ACTIVE_BY_DEFAULT: readonly string[] = ['congiunzione', 'opposizione', 'trigono', 'quadrato', 'sestile'];
/** Aspect orbs that cap the point orb by default; the others use the point orb. */
const DEFAULT_ASPECT_ORBS: Readonly<Record<string, number>> = {quintile: 3, semiquadrato: 3, quinconce: 2, phisolare: 2, philunare: 2};
const HIDDEN_BY_DEFAULT: readonly string[] = ['mean Node', 'mean Node Sud', 'mean Apogee', 'mean Perigee'];
/** Hidden mean points stay out of the chart until selected. */
const NO_ASPECTS_BY_DEFAULT: readonly string[] = HIDDEN_BY_DEFAULT;
const LEGACY_VISIBLE_ASPECTS = ['Uranus', 'Neptune', 'Pluto', 'Chiron'] as const;

export function defaultChartSettings(): ChartSettings {
  const aspects = {} as Record<AspectId, AspectSetting>;
  for (const {id} of ASPECT_DEFINITIONS) {
    aspects[id] = {active: ACTIVE_BY_DEFAULT.includes(id), orb: DEFAULT_ASPECT_ORBS[id] ?? null};
  }
  const points = {} as Record<PointId, PointSetting>;
  for (const id of POINT_IDS) {
    points[id] = {shown: !HIDDEN_BY_DEFAULT.includes(id), orb: DEFAULT_POINT_ORB, aspects: !NO_ASPECTS_BY_DEFAULT.includes(id)};
  }
  return {showAspects: true, australInversion:false, outerWhenConjunct:false, planetOfYear:false,
    focusAspects:false, applicationMode:'off', showDecans:false, showDecades:false, showTerms:false,
    fixedStars:{magnitudeLimit:null, includeUnknownMagnitude:true, longitudeOrb:1, axisOrb:1}, aspects, points};
}

function record(x: unknown): Record<string, unknown> | null {
  return x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null;
}

/** Orbs are kept to tenths of a degree so stored and displayed values agree. */
function orbValue(x: unknown, min: number): number | null {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > MAX_ORB_DEG) return null;
  return Math.round(x * 10) / 10;
}

/**
 * Field-by-field: every valid value is kept, anything unknown, missing or out
 * of range falls back to its default. Extra keys are dropped.
 */
export function sanitizeChartSettings(raw: unknown): ChartSettings {
  const settings = defaultChartSettings();
  const source = record(raw);
  if (!source) return settings;
  if (typeof source['showAspects'] === 'boolean') settings.showAspects = source['showAspects'];
  for (const key of ['australInversion','outerWhenConjunct','planetOfYear','focusAspects','showDecans','showDecades','showTerms'] as const) {
    if (Object.hasOwn(source,key) && typeof source[key] === 'boolean') settings[key] = source[key];
  }
  if (Object.hasOwn(source,'applicationMode') && (source['applicationMode'] === 'off' || source['applicationMode'] === 'applying' || source['applicationMode'] === 'separating')) settings.applicationMode = source['applicationMode'];
  const stars = record(source['fixedStars']);
  if (stars) {
    if (stars['magnitudeLimit'] === null) settings.fixedStars.magnitudeLimit = null;
    else if (typeof stars['magnitudeLimit'] === 'number' && Number.isFinite(stars['magnitudeLimit']) && stars['magnitudeLimit'] >= -10 && stars['magnitudeLimit'] <= 20)
      settings.fixedStars.magnitudeLimit = Math.round(stars['magnitudeLimit'] * 10) / 10;
    if (typeof stars['includeUnknownMagnitude'] === 'boolean') settings.fixedStars.includeUnknownMagnitude = stars['includeUnknownMagnitude'];
    settings.fixedStars.longitudeOrb = orbValue(stars['longitudeOrb'], 0) ?? settings.fixedStars.longitudeOrb;
    settings.fixedStars.axisOrb = orbValue(stars['axisOrb'], 0) ?? settings.fixedStars.axisOrb;
  }
  const aspects = record(source['aspects']);
  const points = record(source['points']);
  for (const {id} of ASPECT_DEFINITIONS) {
    const item = aspects && Object.hasOwn(aspects, id) ? record(aspects[id]) : null;
    if (!item) continue;
    if (typeof item['active'] === 'boolean') settings.aspects[id].active = item['active'];
    if (item['orb'] === null) settings.aspects[id].orb = null;
    else settings.aspects[id].orb = orbValue(item['orb'], 0.1) ?? settings.aspects[id].orb;
  }
  for (const id of POINT_IDS) {
    const item = points && Object.hasOwn(points, id) ? record(points[id]) : null;
    if (!item) continue;
    if (typeof item['shown'] === 'boolean') settings.points[id].shown = item['shown'];
    if (typeof item['aspects'] === 'boolean') settings.points[id].aspects = item['aspects'];
    settings.points[id].orb = orbValue(item['orb'], 0) ?? settings.points[id].orb;
  }
  return settings;
}

export interface ChartSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const CHART_SETTINGS_KEY = 'virgostars.desktop.chart-settings.v1';
export const FIXED_STAR_DEFAULTS_KEY = 'virgostars.desktop.fixed-star-defaults.v1';
const MAX_STORED_LENGTH = 8192;

/** Only explicitly saved star defaults survive between application sessions. */
export function loadFixedStarDefaults(storage: ChartSettingsStorage | null): FixedStarSettings {
  try {
    const raw = storage?.getItem(FIXED_STAR_DEFAULTS_KEY);
    if (!raw || raw.length > 1024) return defaultChartSettings().fixedStars;
    const data = record(JSON.parse(raw));
    if (!data || data['version'] !== 1) return defaultChartSettings().fixedStars;
    return sanitizeChartSettings({fixedStars:data['settings']}).fixedStars;
  } catch { return defaultChartSettings().fixedStars; }
}

export function saveFixedStarDefaults(storage: ChartSettingsStorage | null, settings: FixedStarSettings): boolean {
  try {
    if (!storage) return false;
    const sanitized = sanitizeChartSettings({fixedStars:settings}).fixedStars;
    storage.setItem(FIXED_STAR_DEFAULTS_KEY, JSON.stringify({version:1, settings:sanitized}));
    return true;
  } catch { return false; }
}

/** Old chart-settings snapshots held automatically saved star values. They are
 * not explicit defaults and must not override the new 1° starting values. */
export function loadChartSettingsForSession(storage: ChartSettingsStorage | null): ChartSettings {
  const settings = loadChartSettings(storage);
  settings.fixedStars = loadFixedStarDefaults(storage);
  return settings;
}

/** Unknown versions, damaged text and inaccessible storage all yield the defaults. */
export function loadChartSettings(storage: ChartSettingsStorage | null): ChartSettings {
  try {
    const raw = storage?.getItem(CHART_SETTINGS_KEY);
    if (!raw || raw.length > MAX_STORED_LENGTH) return defaultChartSettings();
    const data = record(JSON.parse(raw));
    if (!data || (data['version'] !== 1 && data['version'] !== 2)) return defaultChartSettings();
    const settings = sanitizeChartSettings(data['settings']);
    if (data['version'] === 1) {
      const source = record(data['settings']);
      const points = source && record(source['points']);
      // Upgrade only the old four-point default as a group; mixed selections
      // already contain an identifiable user choice and remain untouched.
      if (points && LEGACY_VISIBLE_ASPECTS.every(id => record(points[id])?.['aspects'] === false)) {
        for (const id of LEGACY_VISIBLE_ASPECTS) settings.points[id].aspects = true;
      }
      try { storage?.setItem(CHART_SETTINGS_KEY, JSON.stringify({version:2, settings})); } catch { /* best effort */ }
    }
    return settings;
  } catch {
    return defaultChartSettings();
  }
}

/** Best effort: a failed write never stops the interface. Only sanitized values are stored. */
export function saveChartSettings(storage: ChartSettingsStorage | null, settings: ChartSettings): boolean {
  try {
    if (!storage) return false;
    storage.setItem(CHART_SETTINGS_KEY, JSON.stringify({version: 2, settings: sanitizeChartSettings(settings)}));
    return true;
  } catch {
    return false;
  }
}

/** Parses an orb typed by the user: `.` or `,`, one decimal; empty means "none". */
export function parseOrb(raw: string, min: number): number | null | undefined {
  const text = String(raw ?? '').trim().replace(',', '.');
  if (text === '') return null;
  if (!/^\d{1,2}(?:\.\d)?$/.test(text)) return undefined;
  const value = Number(text);
  return value >= min && value <= MAX_ORB_DEG ? value : undefined;
}
