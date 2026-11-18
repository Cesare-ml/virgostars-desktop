import type {UiPreferencesStorage} from './ui-preferences';

export const CHART_SKINS = ['virgostars', 'light', 'dark', 'light-bn', 'dark-bn', 'sun', 'astrolabio', 'astrolabio-girasole'] as const;
export type ChartSkin = typeof CHART_SKINS[number];
export const CHART_SKIN_KEY = 'virgostars.desktop.chart-skin.v1';

export function isChartSkin(value: unknown): value is ChartSkin {
  return typeof value === 'string' && (CHART_SKINS as readonly string[]).includes(value);
}

export function loadChartSkin(storage: UiPreferencesStorage | null): ChartSkin {
  try {
    const value = storage?.getItem(CHART_SKIN_KEY);
    return isChartSkin(value) ? value : 'virgostars';
  } catch { return 'virgostars'; }
}

export function saveChartSkin(storage: UiPreferencesStorage | null, value: ChartSkin): void {
  try { if (storage && isChartSkin(value)) storage.setItem(CHART_SKIN_KEY, value); } catch { /* optional preference */ }
}
