/**
 * UI-only guard for an explicit chart redraw after a failed synthetic render.
 * This does not reset WebGL, authorize external data, or retry native IPC.
 */
export interface ChartRetryState {
  readonly initialized: boolean;
  readonly destroyed: boolean;
  readonly busy: boolean;
  readonly ready: boolean;
  readonly exporting: boolean;
  readonly hasError: boolean;
}

/** Refuse retries during teardown, startup, export or another redraw. */
export function canRetryChartRender(state: ChartRetryState | null | undefined): boolean {
  return state !== null && state !== undefined &&
    state.initialized === true &&
    state.destroyed === false &&
    state.busy === false &&
    state.ready === false &&
    state.exporting === false &&
    state.hasError === true;
}
