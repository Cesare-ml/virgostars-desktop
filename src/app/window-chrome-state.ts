/**
 * Coalesce overlapping native window-state reads without timers or polling.
 * A resize burst can trigger repeated reads, but only one can be active;
 * queued events always get one final refresh after the current read.
 * This helper does not access native APIs and can be tested without Tauri.
 */
export class WindowChromeStateCoordinator {
  private inFlight = false;
  private dirty = false;
  private disposed = false;
  private readonly readMaximized: () => Promise<boolean>;
  private readonly publish: (value: boolean) => void;

  constructor(readMaximized: () => Promise<boolean>, publish: (value: boolean) => void) {
    this.readMaximized = readMaximized;
    this.publish = publish;
  }

  refresh(): void {
    if (this.disposed) return;
    if (this.inFlight) {
      this.dirty = true;
      return;
    }
    void this.drain();
  }

  dispose(): void {
    this.disposed = true;
    this.dirty = false;
  }

  private async drain(): Promise<void> {
    if (this.inFlight || this.disposed) return;
    this.inFlight = true;
    try {
      do {
        this.dirty = false;
        try {
          const maximized = await this.readMaximized();
          if (this.disposed) return;
          this.publish(maximized);
        } catch {
          // No fatal UI failure for a transient/unavailable native query.
          // A later user or OS event can request another refresh.
        }
      } while (this.dirty && !this.disposed);
    } finally {
      this.inFlight = false;
    }
  }
}
