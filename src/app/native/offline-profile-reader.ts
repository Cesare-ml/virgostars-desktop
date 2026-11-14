/** Narrow, runtime-free interface implemented by LatestProfileStatus. */
export interface OfflineProfileStatusGate<TDecision> {
  readonly decision: TDecision;
  begin(): symbol | null;
  complete(token: unknown, evidence: unknown): boolean;
  invalidate(): void;
  dispose(): void;
}

/** A mockable future native status-only read, never account authentication. */
export type OfflineProfileStatusPort = (signal: AbortSignal) => Promise<unknown>;

/** Injected clocks permit deterministic tests without sleeping or native IPC. */
export interface OfflineProfileReaderTimers {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}
export interface OfflineProfileReaderOptions {
  readonly timeoutMs?: number;
  readonly timers?: OfflineProfileReaderTimers;
}
const DEFAULT_TIMEOUT_MS = 4000;
const MAX_TIMEOUT_MS = 30000;
const SYSTEM_TIMERS: OfflineProfileReaderTimers = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Bounded UI-status orchestration for a future reviewed native profile reader.
 * One in-flight read and at most one replaceable pending read. Requests already
 * running in a native process cannot necessarily be cancelled by AbortSignal;
 * this controller will NOT spawn another until the old port settles.
 *
 * A local timeout blocks the UI and requests cancellation, but DOES NOT free
 * the in-flight slot. A non-cooperative, forever-pending port will continue
 * blocking subsequent refreshes until the Rust adapter completes it.
 * Never use these decisions as an authorization or cryptographic boundary.
 */
export class LatestOfflineProfileReader<TDecision> {
  private readonly gate: OfflineProfileStatusGate<TDecision>;
  private readonly read: OfflineProfileStatusPort;
  private readonly changed: (decision: TDecision) => void;
  private readonly timeoutMs: number;
  private readonly timers: OfflineProfileReaderTimers;
  private active: AbortController | null = null;
  private deadline: {controller: AbortController; handle: unknown} | null = null;
  private pending: symbol | null = null;
  private disposed = false;
  private notifying = false;
  private notifyAgain = false;

  constructor(gate: OfflineProfileStatusGate<TDecision>,
    read: OfflineProfileStatusPort,
    changed: (decision: TDecision) => void = () => {},
    options: OfflineProfileReaderOptions = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS)
      throw new Error('Invalid profile status timeout');
    this.read = read;
    this.gate = gate;
    this.changed = changed;
    this.timeoutMs = timeoutMs;
    this.timers = options.timers ?? SYSTEM_TIMERS;
  }

  get decision(): TDecision { return this.gate.decision; }

  /** Reset the visible decision immediately, then request a fresh status. */
  refresh(): boolean {
    if (this.disposed) return false;
    const ticket = this.gate.begin();
    if (ticket === null) return false;
    if (this.active) {
      this.pending = ticket;
      this.clearDeadline();
      this.active.abort();
    } else {
      this.launch(ticket);
    }
    this.emit();
    return true;
  }

  /** Lock, logout or change account: cancel pending and blank the UI now. */
  invalidate(): void {
    if (this.disposed) return;
    this.gate.invalidate();
    this.pending = null;
    this.clearDeadline();
    this.active?.abort();
    this.emit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending = null;
    this.gate.dispose();
    this.clearDeadline();
    this.active?.abort();
    this.emit();
  }

  private emit(): void {
    // A subscriber may synchronously lock, refresh or dispose the profile.
    // Queue at most one follow-up notification; otherwise a listener that
    // invalidates on every callback can recurse until stack exhaustion.
    if (this.notifying) {
      this.notifyAgain = true;
      return;
    }
    this.notifying = true;
    try {
      for (let delivery = 0; delivery < 2; delivery++) {
        this.notifyAgain = false;
        try { this.changed(this.gate.decision); }
        catch { /* UI observers cannot poison scheduling or leak errors. */ }
        if (!this.notifyAgain) break;
      }
    } finally {
      this.notifyAgain = false;
      this.notifying = false;
    }
  }

  private clearDeadline(): void {
    const scheduled = this.deadline;
    this.deadline = null;
    if (scheduled !== null) {
      try { this.timers.cancel(scheduled.handle); }
      catch { /* Never log scheduler errors or break offline teardown. */ }
    }
  }

  private launch(ticket: symbol): void {
    if (this.disposed) return;
    const controller = new AbortController();
    this.active = controller;
    // Coalesce same-turn refreshes before invoking an expensive future port.
    void Promise.resolve().then(() => {
      if (this.disposed || controller.signal.aborted) return undefined;
      let handle: unknown;
      try {
        handle = this.timers.schedule(() => {
          if (this.disposed || controller.signal.aborted || this.active !== controller) return;
          // Do not free this.active: a non-cooperative native request may still
          // hold resources. Suppress its eventual success and fail closed.
          this.clearDeadline();
          controller.abort();
          if (this.gate.complete(ticket,null)) this.emit();
        }, this.timeoutMs);
      } catch {
        controller.abort();
        if (this.gate.complete(ticket,null)) this.emit();
        return undefined;
      }
      if (handle === null || handle === undefined) {
        controller.abort();
        if (this.gate.complete(ticket,null)) this.emit();
        return undefined;
      }
      // Broken injected schedulers can fire synchronously during schedule().
      // Do not start an already-timed-out read or retain an orphaned handle.
      if (this.disposed || controller.signal.aborted) {
        try { this.timers.cancel(handle); } catch { /* best effort */ }
        return undefined;
      }
      this.deadline = {controller,handle};
      return this.read(controller.signal);
    }).then(
      payload => {
        if (this.disposed || controller.signal.aborted) return;
        if (this.gate.complete(ticket,payload)) this.emit();
      },
      () => {
        if (this.disposed || controller.signal.aborted) return;
        if (this.gate.complete(ticket,null)) this.emit();
      },
    ).finally(() => {
      if (this.deadline?.controller === controller) this.clearDeadline();
      if (this.active === controller) this.active = null;
      const next = this.pending;
      this.pending = null;
      if (next !== null && !this.disposed) this.launch(next);
    });
  }
}
