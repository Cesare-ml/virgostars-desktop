import type { Locale } from './translations';
import type { UiTheme } from './workspace-state';

/** Device-only, non-sensitive UI choices. Never extend this to subjects or auth. */
export interface UiPreferences {
  theme: UiTheme;
  locale: Locale | 'auto';
}

export interface UiPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const UI_PREFERENCES_KEY = 'virgostars.desktop.ui-preferences.v1';
export const DEFAULT_UI_PREFERENCES: Readonly<UiPreferences> = Object.freeze({theme:'light', locale:'auto'});

/** WebView language follows the device preference; unsupported languages use English. */
export function resolveLocale(preference: Locale | 'auto', systemLanguage?: string): Locale {
  if (preference !== 'auto') return preference;
  const language = systemLanguage ?? (typeof navigator === 'undefined' ? '' : navigator.language);
  return /^it(?:-|$)/i.test(language) ? 'it' : 'en';
}

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
      locale: record['locale'] === 'en' || record['locale'] === 'it' ? record['locale'] : 'auto',
    };
  } catch { return {...DEFAULT_UI_PREFERENCES}; }
}

/** Best-effort persistence: failed writes and malformed callers never stop the local UI. */
export function saveUiPreferences(storage: UiPreferencesStorage | null, preferences: UiPreferences): boolean {
  try {
    if (!storage || !preferences) return false;
    // Snapshot exactly once. Mutable/accessor-backed values must not change
    // between validation and serialization, or inject unrelated fields.
    const theme = preferences.theme;
    const locale = preferences.locale;
    if ((theme !== 'light' && theme !== 'dark') || (locale !== 'it' && locale !== 'en' && locale !== 'auto')) return false;
    storage.setItem(UI_PREFERENCES_KEY, JSON.stringify({version: 1, theme, locale}));
    return true;
  } catch { return false; }
}
