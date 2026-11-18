// Pure UI geometry/state helpers. No astronomy, persistence, or server access.
export type ChartMode = 'natal' | 'transits' | 'synastry' | 'latitude';
export type UiTheme = 'light' | 'dark';
/** What the centre of the window shows over the chart: nothing, the new-chart form or the archive. */
export type WorkspaceView = 'chart' | 'new' | 'archive' | 'functions' | 'settings';
export type InspectorTab = 'planets' | 'aspects' | 'navigate' | 'transits' | 'zodiac';
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
/** The sky of the moment refreshes itself this often while it is running. */
export const SKY_REFRESH_MS = 33_000;
/** Margin (CSS px) kept between the wheel and the edge of its area. */
export const CHART_MARGIN_PX = 12;
/** Widths (CSS px) of the side columns; keep in step with desktop-app.component.css. */
export const NAV_WIDTH_PX = 208;
export const INSPECTOR_WIDTH_PX = 400;
/** At or below this window width the inspector floats over the chart instead of taking a column. */
export const INSPECTOR_OVERLAY_MAX_PX = 1140;
/**
 * The wheel is as tall as the window whenever the centre column is at least as wide as it is tall.
 * When it is not, the navigation folds to its icon rail so the chart keeps the full height.
 */
export function shouldCollapseNavigation(windowWidth: number, windowHeight: number, inspectorOpen: boolean): boolean {
  if (![windowWidth, windowHeight].every(Number.isFinite) || windowWidth <= 0 || windowHeight <= 0) return false;
  const inspector = inspectorOpen && windowWidth > INSPECTOR_OVERLAY_MAX_PX ? INSPECTOR_WIDTH_PX : 0;
  return windowWidth - NAV_WIDTH_PX - inspector < windowHeight;
}
export function navigationLabel(mode: ChartMode): string {
  const labels: Record<ChartMode,string> = { natal:'mode.natal', transits:'mode.transits', synastry:'mode.synastry', latitude:'mode.latitude' };
  return labels[mode];
}
export function safeMode(input: string): ChartMode | null {
  return CHART_MODES.includes(input as ChartMode) ? input as ChartMode : null;
}
