/**
 * Keep chart layout responsive when a WebView cannot construct/use ResizeObserver.
 * A window-resize fallback is less precise for sidebar transitions, but must
 * never block first chart rendering. No data or network access is involved.
 */
export interface StageResizeObserver {
  observe(target: Element): void;
  disconnect(): void;
}

export interface StageResizeEnvironment {
  createObserver(notify: () => void): StageResizeObserver;
  addWindowListener(notify: () => void): void;
  removeWindowListener(notify: () => void): void;
}

const BROWSER_ENVIRONMENT: StageResizeEnvironment = {
  createObserver: notify => new ResizeObserver(notify),
  addWindowListener: notify => window.addEventListener('resize', notify),
  removeWindowListener: notify => window.removeEventListener('resize', notify),
};

/** Subscribe at most once; returned cleanup is idempotent, including late events. */
export function watchChartStageResize(
  target: Element,
  changed: () => void,
  environment: StageResizeEnvironment = BROWSER_ENVIRONMENT,
): () => void {
  let stopped = false;
  // Callback ownership changes on fallback. A partially attached observer may
  // still deliver queued notifications even after disconnect() throws or runs.
  let source: 'observer' | 'window' = 'observer';
  const notify = (from: 'observer' | 'window') => {
    if (stopped || source !== from) return;
    // A transient layout/read error belongs to the UI, not the observer port.
    // Never switch observation strategy or leak private renderer exceptions.
    try { changed(); } catch { /* Keep later layout notifications alive. */ }
  };
  const observerNotify = () => notify('observer');
  const windowNotify = () => notify('window');
  let observer: StageResizeObserver | null = null;
  try {
    observer = environment.createObserver(observerNotify);
    observer.observe(target);
    return () => {
      if (stopped) return;
      stopped = true;
      try { observer?.disconnect(); } catch { /* Teardown never blocks the host. */ }
    };
  } catch {
    // Invalidate queued callbacks from the abandoned observer *before* cleanup.
    source = 'window';
    try { observer?.disconnect(); } catch { /* Fall back anyway. */ }
  }

  try {
    environment.addWindowListener(windowNotify);
    return () => {
      if (stopped) return;
      stopped = true;
      try { environment.removeWindowListener(windowNotify); } catch { /* Late events are gated. */ }
    };
  } catch {
    // addEventListener may have partially attached before reporting failure.
    // Invalidate even a leaked callback first; attempt symmetric cleanup.
    stopped = true;
    try { environment.removeWindowListener(windowNotify); } catch { /* Failed setup stays inert. */ }
    return () => {};
  }
}


/**
 * A sidebar class change is rendered by Angular after the click handler.
 * Two animation frames let both Zone and zoneless Angular apply the DOM layout
 * before sampling the chart stage. This is only a UI recovery path.
 */
export interface StageLayoutFrames {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

const BROWSER_LAYOUT_FRAMES: StageLayoutFrames = {
  request: callback => requestAnimationFrame(callback),
  cancel: handle => cancelAnimationFrame(handle),
};

/** Coalesce rapid panel toggles and suppress callbacks after component teardown. */
export class StageLayoutRefresh {
  private handle: number | null = null;
  private phase: 0 | 1 | 2 = 0;
  private generation = 0;
  private disposed = false;

  private readonly refresh: () => void;
  private readonly frames: StageLayoutFrames;

  constructor(refresh: () => void, frames: StageLayoutFrames = BROWSER_LAYOUT_FRAMES) {
    this.refresh = refresh;
    this.frames = frames;
  }

  request(): void {
    if (this.disposed || this.phase !== 0) return;
    this.phase = 1;
    this.arm(++this.generation, 1);
  }

  private arm(ticket: number, phase: 1 | 2): void {
    try {
      const handle = this.frames.request(() => {
        if (this.disposed || ticket !== this.generation || this.phase !== phase) return;
        this.handle = null;
        if (phase === 1) {
          this.phase = 2;
          this.arm(ticket, 2);
        } else {
          this.phase = 0;
          try { this.refresh(); } catch { /* A transient layout error is recoverable. */ }
        }
      });
      // requestAnimationFrame returns a numeric ID; refuse malformed drivers.
      if (!Number.isSafeInteger(handle) || handle < 0) {
        this.generation++;
        this.phase = 0;
        return;
      }
      this.handle = handle;
    } catch {
      this.generation++;
      this.phase = 0;
      this.handle = null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.phase = 0;
    const handle = this.handle;
    this.handle = null;
    if (handle !== null) {
      try { this.frames.cancel(handle); } catch { /* Late callbacks remain guarded. */ }
    }
  }
}
