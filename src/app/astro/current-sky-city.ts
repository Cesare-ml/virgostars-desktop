import type {OfflinePlaceV1} from '../native/offline-places-contract';
import type {UiPreferencesStorage} from '../ui-preferences';

export const CURRENT_SKY_CITY_KEY = 'virgostars.desktop.current-sky-city.v1';

/** Persist only a user-selected city, never an inferred device position. */
export function saveCurrentSkyCity(storage: UiPreferencesStorage | null, city: OfflinePlaceV1 | null): boolean {
  try {
    if (!storage) return false;
    if (city === null) {
      // Storage interface intentionally supports only get/set.
      storage.setItem(CURRENT_SKY_CITY_KEY, '');
      return true;
    }
    const {id, name, latMicro, lngMicro, timeZone} = city;
    if (!Number.isSafeInteger(id) || id < 0 || typeof name !== 'string' || !name.trim() || name.length > 255 ||
        !Number.isSafeInteger(latMicro) || Math.abs(latMicro) > 90_000_000 ||
        !Number.isSafeInteger(lngMicro) || Math.abs(lngMicro) > 180_000_000 ||
        (timeZone !== null && (typeof timeZone !== 'string' || timeZone.length > 100))) return false;
    storage.setItem(CURRENT_SKY_CITY_KEY, JSON.stringify({version: 1, id, name, latMicro, lngMicro, timeZone}));
    return true;
  } catch { return false; }
}

export function loadCurrentSkyCity(storage: UiPreferencesStorage | null): OfflinePlaceV1 | null {
  try {
    const raw = storage?.getItem(CURRENT_SKY_CITY_KEY);
    if (!raw || raw.length > 700) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    if (item['version'] !== 1 || !Number.isSafeInteger(item['id']) || (item['id'] as number) < 0 ||
        typeof item['name'] !== 'string' || !(item['name'] as string).trim() || (item['name'] as string).length > 255 ||
        !Number.isSafeInteger(item['latMicro']) || Math.abs(item['latMicro'] as number) > 90_000_000 ||
        !Number.isSafeInteger(item['lngMicro']) || Math.abs(item['lngMicro'] as number) > 180_000_000 ||
        (item['timeZone'] !== null && (typeof item['timeZone'] !== 'string' || item['timeZone'].length > 100))) return null;
    return Object.freeze({
      id: item['id'] as number, name: item['name'] as string,
      latMicro: item['latMicro'] as number, lngMicro: item['lngMicro'] as number,
      timeZone: item['timeZone'] as string | null,
      italianName: null, population: null, stateId: null, region: null, countryName: null, countryCode: null,
    });
  } catch { return null; }
}
