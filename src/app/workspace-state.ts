// Pure UI geometry/state helpers. No astronomy, persistence, or server access.
export type ChartMode = 'natal' | 'transits' | 'synastry' | 'latitude';
export type UiTheme = 'light' | 'dark';
export type InspectorTab = 'planets' | 'houses' | 'settings';
export type Locale = 'it' | 'en';

export const CHART_MODES: ReadonlyArray<ChartMode> = Object.freeze(['natal', 'transits', 'synastry', 'latitude']);
// Conservative CSS-pixel guard against runaway canvas sizes from unexpected
// measurements. Physical backing pixels also depend on devicePixelRatio;
// WebGL/driver limits still require native Windows/macOS acceptance testing.
export const MAX_CHART_SIDE_CSS_PX = 4096;

/**
 * Return a bounded CSS square. The fourth argument caps estimated backing
 * pixels on high-DPI screens, without changing ordinary 1x sizing.
 *
 * This is only a UI budget: the upstream renderer may apply extra scaling.
 */
export function chartSide(width: number, height: number, padding = 24, devicePixelRatio = 1): number {
  if (![width, height, padding, devicePixelRatio].every(Number.isFinite) ||
      width < 0 || height < 0 || padding < 0 || devicePixelRatio <= 0) return 0;
  const available = Math.floor(Math.min(width, height) - 2 * padding);
  // DPR below 1 does not justify relaxing the original 4096 CSS-pixel cap.
  const maxCssSideForDpr = Math.floor(MAX_CHART_SIDE_CSS_PX / Math.max(1, devicePixelRatio));
  return Math.max(0, Math.min(available, MAX_CHART_SIDE_CSS_PX, maxCssSideForDpr));
}
export function navigationLabel(mode: ChartMode): string {
  const labels: Record<ChartMode,string> = { natal:'mode.natal', transits:'mode.transits', synastry:'mode.synastry', latitude:'mode.latitude' };
  return labels[mode];
}
export function safeMode(input: string): ChartMode | null {
  return CHART_MODES.includes(input as ChartMode) ? input as ChartMode : null;
}
