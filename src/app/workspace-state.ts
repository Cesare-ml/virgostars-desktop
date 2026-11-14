// Pure UI geometry/state helpers. No astronomy, persistence, or server access.
export type ChartMode = 'natal' | 'transits' | 'synastry' | 'latitude';
export type UiTheme = 'light' | 'dark';
export type InspectorTab = 'planets' | 'houses' | 'settings';
export type Locale = 'it' | 'en';

export const CHART_MODES: ReadonlyArray<ChartMode> = Object.freeze(['natal', 'transits', 'synastry', 'latitude']);
// Conservative CSS-pixel guard against runaway canvas sizes from unexpected
// measurements. WebGL/driver limits still require Windows/macOS testing.
export const MAX_CHART_SIDE_CSS_PX = 4096;
// A separate backing-pixel budget for high-DPI displays. The upstream renderer
// owns its actual WebGL allocation, so this is a layout-side guard, not a
// claim about physical texture sizes or GPU memory.
export const MAX_CHART_BACKING_SIDE_PX = 4096;

export function chartSide(width: number, height: number, padding = 24, devicePixelRatio = 1): number {
  if (![width, height, padding, devicePixelRatio].every(Number.isFinite) ||
      width < 0 || height < 0 || padding < 0 || devicePixelRatio <= 0) return 0;
  const available = Math.floor(Math.min(width, height) - 2 * padding);
  // DPR below one must not increase the existing CSS-pixel limit; fractional
  // and high-DPI scaling always round down to stay inside both budgets.
  const backingBound = Math.floor(MAX_CHART_BACKING_SIDE_PX / Math.max(1, devicePixelRatio));
  return Math.max(0, Math.min(available, MAX_CHART_SIDE_CSS_PX, backingBound));
}
export function navigationLabel(mode: ChartMode): string {
  const labels: Record<ChartMode,string> = { natal:'mode.natal', transits:'mode.transits', synastry:'mode.synastry', latitude:'mode.latitude' };
  return labels[mode];
}
export function safeMode(input: string): ChartMode | null {
  return CHART_MODES.includes(input as ChartMode) ? input as ChartMode : null;
}
