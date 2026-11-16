/**
 * UI-only gate for an explicit redraw after a completed render failure.
 * It does not restore WebGL, reinitialize the renderer or retry native IPC.
 */
export interface ChartRetryState {
  readonly initialized: boolean;
  readonly destroyed: boolean;
  readonly busy: boolean;
  readonly ready: boolean;
  readonly exporting: boolean;
  readonly hasError: boolean;
}

/** Permit retry only while the same initialized renderer is alive and idle. */
export function canRetryChartRender(state: ChartRetryState | null | undefined): boolean {
  return state !== null && state !== undefined &&
    state.initialized === true &&
    state.destroyed === false &&
    state.busy === false &&
    state.ready === false &&
    state.exporting === false &&
    state.hasError === true;
}
