import type {InspectorTab} from './workspace-state';
import type {UiPreferencesStorage} from './ui-preferences';

/** Only a navigation choice, never chart data, locations, records or credentials. */
export const INSPECTOR_TAB_KEY = 'virgostars.desktop.inspector-tab.v1';
export const DEFAULT_INSPECTOR_TAB: InspectorTab = 'planets';

export function isInspectorTab(value: unknown): value is InspectorTab {
  return value === 'planets' || value === 'houses' || value === 'settings';
}

/** Read a single allowlisted enum, treating denied/corrupt storage as a fresh UI. */
export function loadInspectorTab(storage: UiPreferencesStorage | null): InspectorTab {
  try {
    const saved = storage?.getItem(INSPECTOR_TAB_KEY);
    return isInspectorTab(saved) ? saved : DEFAULT_INSPECTOR_TAB;
  } catch {
    return DEFAULT_INSPECTOR_TAB;
  }
}

/** Best effort. Never persist chart positions, subjects or arbitrary caller data. */
export function saveInspectorTab(storage: UiPreferencesStorage | null, tab: InspectorTab): boolean {
  try {
    if (!storage || !isInspectorTab(tab)) return false;
    storage.setItem(INSPECTOR_TAB_KEY, tab);
    return true;
  } catch {
    return false;
  }
}
