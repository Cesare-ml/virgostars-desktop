/** Read-only computed-style and geometry smoke probe for Windows/WebView2.
 * This checks applied layout, not merely compiled assets.
 * A positive result is NOT an end-to-end visual, accessibility or CSP audit.
 */
export type DesktopLayoutStatus = 'active' | 'missing' | 'hidden' | 'collapsed' | 'unavailable';

export interface DesktopLayoutElements {
  readonly shell: Element | null;
  readonly workspace: Element | null;
  readonly stage: Element | null;
  readonly canvas: HTMLCanvasElement | null;
}

export interface DesktopStyleRead {
  readonly display: string;
  readonly visibility: string;
  readonly opacity: string;
  getPropertyValue(name: string): string;
}
export interface DesktopLayoutRect {
  readonly width: number;
  readonly height: number;
  readonly top?: number;
  readonly left?: number;
}
export interface DesktopViewport {
  readonly width: number;
  readonly height: number;
}

export type ReadDesktopStyle = (element: Element) => DesktopStyleRead;
export type ReadDesktopRect = (element: Element) => DesktopLayoutRect;

const MIN_SURFACE_PX = 96;
const MIN_CANVAS_PX = 32;
const MIN_CANVAS_STAGE_RATIO = 0.25;

/** Never request remote assets, log DOM contents or mutate the document. */
export function probeDesktopLayout(
  elements: DesktopLayoutElements,
  readStyle: ReadDesktopStyle = element => getComputedStyle(element),
  readRect: ReadDesktopRect = element => element.getBoundingClientRect(),
  viewport: DesktopViewport | null = typeof window !== 'undefined' ?
    {width:window.innerWidth, height:window.innerHeight} : null,
): DesktopLayoutStatus {
  try {
    if (!elements || !elements.shell || !elements.workspace || !elements.stage || !elements.canvas) {
      return 'unavailable';
    }
    const shell = readStyle(elements.shell);
    const workspace = readStyle(elements.workspace);
    const stage = readStyle(elements.stage);
    const canvasStyle = readStyle(elements.canvas);
    const accent = shell.getPropertyValue('--vs-accent').trim();
    if (shell.display !== 'grid' || workspace.display !== 'grid' ||
        stage.display !== 'grid' || accent.length === 0) {
      return 'missing';
    }

    // A loaded grid can still be invisible due to runtime/inherited styles.
    // Validate each sampled computed style instead of treating unknown values
    // as visible; opacity is parsed strictly and may be fractional.
    for (const style of [shell, workspace, stage, canvasStyle]) {
      if (typeof style.visibility !== 'string' ||
          !['visible', 'hidden', 'collapse'].includes(style.visibility) ||
          typeof style.opacity !== 'string' || style.opacity.trim() === '') {
        return 'unavailable';
      }
      const opacity = Number(style.opacity);
      if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) return 'unavailable';
      if (style.visibility !== 'visible' || opacity === 0) return 'hidden';
    }
    if (canvasStyle.display === 'none') return 'hidden';

    // CSS dimensions do not guarantee a usable HTML canvas drawing buffer.
    // WebView2 may expose a large styled canvas with zero native pixels.
    const backingWidth = elements.canvas.width;
    const backingHeight = elements.canvas.height;
    if (!Number.isSafeInteger(backingWidth) || !Number.isSafeInteger(backingHeight) ||
        backingWidth < 0 || backingHeight < 0) return 'unavailable';
    if (backingWidth < MIN_CANVAS_PX || backingHeight < MIN_CANVAS_PX) return 'collapsed';

    // CSS may be loaded and every display still be grid while a collapsed
    // container or canvas renders only a tiny wheel. Use actual visible boxes.
    const boxes = [elements.shell, elements.workspace, elements.stage, elements.canvas].map(readRect);
    if (boxes.some(box => !Number.isFinite(box.width) || !Number.isFinite(box.height) ||
        box.width < 0 || box.height < 0)) return 'unavailable';
    const [shellBox, workspaceBox, stageBox, canvasBox] = boxes;
    // On WKWebView a valid CSS grid may still occupy only the bottom of the
    // native window. Detect uncovered strips instead of reporting healthy.
    const edgeTolerance = 4; // native fractional CSS-pixel rounding
    const misaligned = (edge: 'top' | 'left'): boolean => {
      const a = shellBox[edge], b = workspaceBox[edge];
      return a !== undefined && b !== undefined &&
        (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > edgeTolerance);
    };
    if (Math.abs(workspaceBox.width - shellBox.width) > edgeTolerance ||
        Math.abs(workspaceBox.height - shellBox.height) > edgeTolerance ||
        misaligned('top') || misaligned('left')) return 'collapsed';
    // The shell itself can be pushed down on macOS. Compare with the actual
    // WebView viewport, not only with its child workspace.
    if (viewport) {
      if (![viewport.width, viewport.height].every(x=>Number.isFinite(x) && x>0)) return 'unavailable';
      if (Math.abs(shellBox.width - viewport.width) > edgeTolerance ||
          Math.abs(shellBox.height - viewport.height) > edgeTolerance ||
          (shellBox.top !== undefined && (!Number.isFinite(shellBox.top) || Math.abs(shellBox.top)>edgeTolerance)) ||
          (shellBox.left !== undefined && (!Number.isFinite(shellBox.left) || Math.abs(shellBox.left)>edgeTolerance)))
        return 'collapsed';
    }
    if ([shellBox, workspaceBox, stageBox].some(box =>
        box.width < MIN_SURFACE_PX || box.height < MIN_SURFACE_PX) ||
        canvasBox.width < MIN_CANVAS_PX || canvasBox.height < MIN_CANVAS_PX ||
        Math.min(canvasBox.width, canvasBox.height) <
          Math.min(stageBox.width, stageBox.height) * MIN_CANVAS_STAGE_RATIO) {
      return 'collapsed';
    }
    return 'active';
  } catch {
    // WebView2/DOM/CSS access failure must not crash or block chart rendering.
    return 'unavailable';
  }
}
