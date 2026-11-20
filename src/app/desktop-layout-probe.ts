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
}

export type ReadDesktopStyle = (element: Element) => DesktopStyleRead;
export type ReadDesktopRect = (element: Element) => DesktopLayoutRect;

const MIN_SURFACE_PX = 96;
const MIN_CANVAS_PX = 32;
const MIN_CANVAS_STAGE_RATIO = 0.25;
// Allow intentional low-resolution rendering, but flag severe CSS upscaling.
const MIN_BACKING_CSS_RATIO = 0.25;

/** Never request remote assets, log DOM contents or mutate the document. */
export function probeDesktopLayout(
  elements: DesktopLayoutElements,
  readStyle: ReadDesktopStyle = element => getComputedStyle(element),
  readRect: ReadDesktopRect = element => element.getBoundingClientRect(),
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
    if ([shellBox, workspaceBox, stageBox].some(box =>
        box.width < MIN_SURFACE_PX || box.height < MIN_SURFACE_PX) ||
        canvasBox.width < MIN_CANVAS_PX || canvasBox.height < MIN_CANVAS_PX ||
        Math.min(canvasBox.width, canvasBox.height) <
          Math.min(stageBox.width, stageBox.height) * MIN_CANVAS_STAGE_RATIO ||
        // A 600px styled canvas backed by only 32 pixels can appear
        // enormous but unreadably pixelated. Check each axis independently.
        backingWidth < canvasBox.width * MIN_BACKING_CSS_RATIO ||
        backingHeight < canvasBox.height * MIN_BACKING_CSS_RATIO) {
      return 'collapsed';
    }
    return 'active';
  } catch {
    // WebView2/DOM/CSS access failure must not crash or block chart rendering.
    return 'unavailable';
  }
}
