import type {MessageKey} from './translations';
import type {UiPreferencesStorage} from './ui-preferences';

/** Versioned, device-only state; no chart data or account details are saved. */
export const GETTING_STARTED_KEY = 'virgostars.desktop.getting-started.v1';
export const GETTING_STARTED_STEPS: ReadonlyArray<Readonly<{title: MessageKey; body: MessageKey}>> = [
  {title:'guide.workspace.title', body:'guide.workspace.body'},
  {title:'guide.charts.title', body:'guide.charts.body'},
  {title:'guide.tools.title', body:'guide.tools.body'},
];

export function shouldShowGettingStarted(storage: UiPreferencesStorage | null): boolean {
  try { return storage?.getItem(GETTING_STARTED_KEY) !== 'done'; }
  catch { return true; }
}

export function dismissGettingStarted(storage: UiPreferencesStorage | null): void {
  try { storage?.setItem(GETTING_STARTED_KEY, 'done'); } catch { /* Best effort. */ }
}
