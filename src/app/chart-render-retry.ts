/**
 * UI-only gate for a user-requested redraw after a completed chart failure.
 * It cannot reinitialize the renderer, restore WebGL, or retry native IPC.
 */
export interface ChartRetryState {
  readonly initialized: boolean;
  readonly destroyed: boolean;
  readonly busy: boolean;
  readonly ready: boolean;
  readonly exporting: boolean;
  readonly hasError: boolean;
}

/** Refuse retries during startup, teardown, export, or another draw. */
export function canRetryChartRender(state: ChartRetryState | null | undefined): boolean {
  return state !== null && state !== undefined &&
    state.initialized === true &&
    state.destroyed === false &&
    state.busy === false &&
    state.ready === false &&
    state.exporting === false &&
    state.hasError === true;
}
