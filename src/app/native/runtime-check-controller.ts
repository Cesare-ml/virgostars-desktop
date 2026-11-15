import type { RuntimeProbeResult } from './runtime-protocol';

/** Pure UI lifecycle for the read-only Tauri environment probe.
 * A successful probe means "synthetic desktop shell", never signed-in or astronomy-ready.
 */
export type RuntimeCheckStatus = 'checking' | 'native' | 'browser' | 'unavailable';

export class RuntimeCheckController {
  status: RuntimeCheckStatus = 'checking';
  checking = false;
  private generation = 0;
  private disposed = false;

  private readonly inspect: () => Promise<RuntimeProbeResult>;
  private readonly onChange: () => void;

  constructor(inspect: () => Promise<RuntimeProbeResult>, onChange: () => void) {
    this.inspect = inspect;
    this.onChange = onChange;
  }

  /** Explicit retry only: no polling, network fallback or native side effects. */
  async check(): Promise<void> {
    if (this.disposed || this.checking) return;
    const ticket = ++this.generation;
    this.checking = true;
    this.status = 'checking';
    this.notify();
    if (!this.isCurrent(ticket)) return;

    try {
      const result = await this.inspect();
      if (!this.isCurrent(ticket)) return;
      this.status = result.kind === 'desktop_demo' ? 'native'
        : result.kind === 'browser_preview' ? 'browser' : 'unavailable';
    } catch {
      // A transport or injected observer must never leak OS details to the UI.
      if (this.isCurrent(ticket)) this.status = 'unavailable';
    } finally {
      if (this.isCurrent(ticket)) {
        this.checking = false;
        this.notify();
      }
    }
  }

  /** Reject late IPC responses after the Angular component is destroyed. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    this.checking = false;
  }

  private isCurrent(ticket: number): boolean {
    return !this.disposed && ticket === this.generation;
  }

  private notify(): void {
    try { this.onChange(); } catch { /* UI observer errors cannot stop the native probe. */ }
  }
}
