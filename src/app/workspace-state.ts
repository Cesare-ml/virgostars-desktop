// Pure UI geometry/state helpers. No astronomy, persistence, or server access.
export type ChartMode = 'natal' | 'transits' | 'synastry' | 'latitude';
export type UiTheme = 'light' | 'dark';
export type InspectorTab = 'planets' | 'houses' | 'settings';
export type Locale = 'it' | 'en';

export const CHART_MODES: ReadonlyArray<ChartMode> = Object.freeze(['natal', 'transits', 'synastry', 'latitude']);
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
