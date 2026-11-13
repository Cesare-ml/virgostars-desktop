import type { Locale } from './translations';
import type { UiTheme } from './workspace-state';

/** Device-only, non-sensitive UI choices. Never extend this to subjects or auth. */
export interface UiPreferences {
  theme: UiTheme;
  locale: Locale;
}

export interface UiPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const UI_PREFERENCES_KEY = 'virgostars.desktop.ui-preferences.v1';
export const DEFAULT_UI_PREFERENCES: Readonly<UiPreferences> = Object.freeze({theme:'light', locale:'it'});

/** Accessing WebView storage may throw (disabled storage, sandbox, private mode). */
export function browserUiPreferencesStorage(): UiPreferencesStorage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; }
}

/** Unknown versions, invalid values and inaccessible storage safely use defaults. */
export function loadUiPreferences(storage: UiPreferencesStorage | null): UiPreferences {
  try {
    const raw = storage?.getItem(UI_PREFERENCES_KEY);
    if (!raw || raw.length > 512) return {...DEFAULT_UI_PREFERENCES};
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {...DEFAULT_UI_PREFERENCES};
    const record = data as Record<string, unknown>;
    if (record['version'] !== 1) return {...DEFAULT_UI_PREFERENCES};
    return {
      theme: record['theme'] === 'dark' ? 'dark' : 'light',
      locale: record['locale'] === 'en' ? 'en' : 'it',
    };
  } catch { return {...DEFAULT_UI_PREFERENCES}; }
}

/** Best-effort persistence: failed writes must never stop the local UI. */
export function saveUiPreferences(storage: UiPreferencesStorage | null, preferences: UiPreferences): boolean {
  if (!storage || !['light','dark'].includes(preferences.theme) || !['it','en'].includes(preferences.locale)) return false;
  try {
    storage.setItem(UI_PREFERENCES_KEY, JSON.stringify({
      version:1, theme:preferences.theme, locale:preferences.locale,
    }));
    return true;
  } catch { return false; }
}
