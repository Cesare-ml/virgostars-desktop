// Pure UI geometry/state helpers. No astronomy, persistence, or server access.
export type ChartMode = 'natal' | 'transits' | 'synastry' | 'latitude';
export type UiTheme = 'light' | 'dark';
export type InspectorTab = 'planets' | 'houses' | 'settings';
export type Locale = 'it' | 'en';

export const CHART_MODES: ReadonlyArray<ChartMode> = Object.freeze(['natal', 'transits', 'synastry', 'latitude']);
export const INSPECTOR_TABS: ReadonlyArray<InspectorTab> = Object.freeze(['planets', 'houses', 'settings']);

// These UI-only thresholds match the breakpoints in desktop-app.component.css.
export function isCompactNavigationWidth(width: number): boolean {
  return Number.isFinite(width) && width >= 0 && width <= 760;
}
export function isOverlayInspectorWidth(width: number): boolean {
  return Number.isFinite(width) && width >= 0 && width <= 1140;
}
export function nextInspectorTab(current: InspectorTab, key: string): InspectorTab | null {
  const index = INSPECTOR_TABS.indexOf(current);
  if (index < 0) return null;
  if (key === 'Home') return INSPECTOR_TABS[0];
  if (key === 'End') return INSPECTOR_TABS[INSPECTOR_TABS.length - 1];
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return INSPECTOR_TABS[(index + 1) % INSPECTOR_TABS.length];
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return INSPECTOR_TABS[(index + INSPECTOR_TABS.length - 1) % INSPECTOR_TABS.length];
  }
  return null;
}
export function chartSide(width: number, height: number, padding = 24): number {
  if (![width, height, padding].every(Number.isFinite) || width < 0 || height < 0 || padding < 0) return 0;
  return Math.max(0, Math.floor(Math.min(width, height) - 2 * padding));
}
export function navigationLabel(mode: ChartMode): string {
  const labels: Record<ChartMode,string> = { natal:'mode.natal', transits:'mode.transits', synastry:'mode.synastry', latitude:'mode.latitude' };
  return labels[mode];
}
export function safeMode(input: string): ChartMode | null {
  return CHART_MODES.includes(input as ChartMode) ? input as ChartMode : null;
}
