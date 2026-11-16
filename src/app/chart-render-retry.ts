/**
 * UI-only gate for an explicit redraw after a completed chart-render failure.
 * It does not reinitialize WebGL, restore a lost context, or retry native IPC.
 */
export interface ChartRetryState {
  readonly initialized: boolean;
  readonly destroyed: boolean;
  readonly busy: boolean;
  readonly ready: boolean;
  readonly exporting: boolean;
  readonly hasError: boolean;
}

/** Only an initialized, idle renderer with a visible error may be redrawn. */
export function canRetryChartRender(state: ChartRetryState | null | undefined): boolean {
  return state !== null && state !== undefined &&
    state.initialized === true &&
    state.destroyed === false &&
    state.busy === false &&
    state.ready === false &&
    state.exporting === false &&
    state.hasError === true;
}
