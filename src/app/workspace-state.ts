// Pure UI geometry/state helpers. No astronomy, persistence, or server access.
export type ChartMode = 'natal' | 'transits' | 'synastry' | 'latitude';
export type UiTheme = 'light' | 'dark';
export type InspectorTab = 'planets' | 'houses' | 'chart' | 'functions' | 'settings';
export type Locale = 'it' | 'en';

export const CHART_MODES: ReadonlyArray<ChartMode> = Object.freeze(['natal', 'transits', 'synastry', 'latitude']);
// Conservative CSS-pixel guard against runaway canvas sizes from unexpected
// measurements. Physical backing pixels also depend on devicePixelRatio;
// WebGL/driver limits still require native Windows/macOS acceptance testing.
export const MAX_CHART_SIDE_CSS_PX = 4096;

export function chartSide(width: number, height: number, padding = 24): number {
  if (![width, height, padding].every(Number.isFinite) || width < 0 || height < 0 || padding < 0) return 0;
  const available = Math.floor(Math.min(width, height) - 2 * padding);
  return Math.max(0, Math.min(available, MAX_CHART_SIDE_CSS_PX));
}
export function navigationLabel(mode: ChartMode): string {
  const labels: Record<ChartMode,string> = { natal:'mode.natal', transits:'mode.transits', synastry:'mode.synastry', latitude:'mode.latitude' };
  return labels[mode];
}
export function safeMode(input: string): ChartMode | null {
  return CHART_MODES.includes(input as ChartMode) ? input as ChartMode : null;
}
