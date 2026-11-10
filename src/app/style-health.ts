/**
 * Read-only CSS diagnostics for the synthetic desktop shell.
 * No network, filesystem, account data, font enumeration or privileged IPC.
 */
export type StyleHealthCode =
  | 'ok'
  | 'both_missing'
  | 'global_missing'
  | 'component_missing'
  | 'layout_unexpected'
  | 'canvas_small';

export interface StyleMeasurements {
  readonly globalMarker: string;
  readonly componentMarker: string;
  readonly shellDisplay: string;
  readonly stageDisplay: string;
  readonly stageWidth: number;
  readonly stageHeight: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
}

export function classifyStyleHealth(metrics: StyleMeasurements): StyleHealthCode {
  const globalAvailable = metrics.globalMarker.trim() === 'ready';
  const componentAvailable = metrics.componentMarker.trim() === 'ready';
  if (!globalAvailable && !componentAvailable) return 'both_missing';
  if (!globalAvailable) return 'global_missing';
  if (!componentAvailable) return 'component_missing';

  if (metrics.shellDisplay !== 'grid' || metrics.stageDisplay !== 'grid' ||
      !Number.isFinite(metrics.stageWidth) || !Number.isFinite(metrics.stageHeight) ||
      metrics.stageWidth < 32 || metrics.stageHeight < 32) {
    return 'layout_unexpected';
  }

  // Only diagnose chart dimensions when the window actually has room for a chart.
  // A tiny split-window is not itself a stylesheet problem.
  const available = Math.min(metrics.stageWidth, metrics.stageHeight);
  if (available >= 300 &&
      (!Number.isFinite(metrics.canvasWidth) || !Number.isFinite(metrics.canvasHeight) ||
       metrics.canvasWidth < available * 0.5 ||
       metrics.canvasHeight < available * 0.5)) {
    return 'canvas_small';
  }
  return 'ok';
}

/** Collect only expected VirgoStars CSS markers and layout measurements. */
export function measureStyleHealth(
  documentRef: Document,
  shell: HTMLElement,
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
): StyleMeasurements {
  const view = documentRef.defaultView;
  if (!view) throw new Error('WebView style inspection unavailable');
  const root = view.getComputedStyle(documentRef.documentElement);
  const shellStyle = view.getComputedStyle(shell);
  const stageStyle = view.getComputedStyle(stage);
  const stageBounds = stage.getBoundingClientRect();
  const canvasBounds = canvas.getBoundingClientRect();
  return {
    globalMarker: root.getPropertyValue('--vs-global-css-marker'),
    componentMarker: shellStyle.getPropertyValue('--vs-component-css-marker'),
    shellDisplay: shellStyle.display,
    stageDisplay: stageStyle.display,
    stageWidth: stageBounds.width,
    stageHeight: stageBounds.height,
    canvasWidth: canvasBounds.width,
    canvasHeight: canvasBounds.height,
  };
}
