import type { UiPreferencesStorage } from './ui-preferences';

/**
 * What the window shows when the program opens: the sky of this moment, or one of
 * the user's saved charts with the transits of this moment. Device-only choice;
 * it stores a mode and the identity of a saved chart, never birth data.
 */
export type StartupMode = 'sky' | 'natal-transits';
export type StartupPreference = Readonly<{mode: StartupMode; chartId: string | null}>;

export const STARTUP_PREFERENCE_KEY = 'virgostars.desktop.startup.v1';
export const DEFAULT_STARTUP_PREFERENCE: StartupPreference = Object.freeze({mode: 'sky', chartId: null});

/**
 * Where the sky of the moment is cast when no chart of the user decides it. Planet
 * positions do not depend on the place; only the houses and angles do.
 */
export const DEFAULT_SKY_PLACE = Object.freeze({
  name: 'Roma', latMicro: 41_893_000, lngMicro: 12_483_000, timeZone: 'Europe/Rome',
});

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Unknown versions, invalid values and unreadable storage use the default: the sky of the moment. */
export function loadStartupPreference(storage: UiPreferencesStorage | null): StartupPreference {
  try {
    const raw = storage?.getItem(STARTUP_PREFERENCE_KEY);
    if (!raw || raw.length > 256) return DEFAULT_STARTUP_PREFERENCE;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return DEFAULT_STARTUP_PREFERENCE;
    const record = data as Record<string, unknown>;
    if (record['version'] !== 1) return DEFAULT_STARTUP_PREFERENCE;
    const id = typeof record['chartId'] === 'string' && ID_PATTERN.test(record['chartId']) ? record['chartId'] : null;
    // Showing "my chart" needs a chart to show.
    return Object.freeze({mode: record['mode'] === 'natal-transits' && id ? 'natal-transits' : 'sky', chartId: id});
  } catch { return DEFAULT_STARTUP_PREFERENCE; }
}

/** Best-effort persistence; a failed write never blocks the window. */
export function saveStartupPreference(storage: UiPreferencesStorage | null, preference: StartupPreference): boolean {
  try {
    if (!storage || !preference) return false;
    const mode = preference.mode;
    const chartId = preference.chartId;
    if ((mode !== 'sky' && mode !== 'natal-transits') || (chartId !== null && !ID_PATTERN.test(chartId))) return false;
    storage.setItem(STARTUP_PREFERENCE_KEY, JSON.stringify({version: 1, mode, chartId}));
    return true;
  } catch { return false; }
}
