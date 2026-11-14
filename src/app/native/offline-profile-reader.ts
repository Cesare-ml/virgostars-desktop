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

/**
 * Bounded UI-status orchestration for a future reviewed native profile reader.
 * One in-flight read and at most one replaceable pending read. Requests already
 * running in a native process cannot necessarily be cancelled by AbortSignal;
 * this controller will NOT spawn another until the old port settles.
 *
 * Never use these decisions as an authorization or cryptographic boundary.
 */
export class LatestOfflineProfileReader<TDecision> {
  private readonly gate: OfflineProfileStatusGate<TDecision>;
  private readonly read: OfflineProfileStatusPort;
  private readonly changed: (decision: TDecision) => void;
  private active: AbortController | null = null;
  private pending: symbol | null = null;
  private disposed = false;

  constructor(gate: OfflineProfileStatusGate<TDecision>,
    read: OfflineProfileStatusPort,
    changed: (decision: TDecision) => void = () => {}) {
    this.read = read;
    this.gate = gate;
    this.changed = changed;
  }

  get decision(): TDecision { return this.gate.decision; }

  /** Reset the visible decision immediately, then request a fresh status. */
  refresh(): boolean {
    if (this.disposed) return false;
    const ticket = this.gate.begin();
    if (ticket === null) return false;
    if (this.active) {
      this.pending = ticket;
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
    this.active?.abort();
    this.emit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending = null;
    this.gate.dispose();
    this.active?.abort();
    this.emit();
  }

  private emit(): void {
    try { this.changed(this.gate.decision); }
    catch { /* UI subscribers cannot poison status scheduling or expose raw errors. */ }
  }

  private launch(ticket: symbol): void {
    if (this.disposed) return;
    const controller = new AbortController();
    this.active = controller;
    // Coalesce same-turn refreshes before invoking an expensive future port.
    void Promise.resolve().then(() => {
      if (this.disposed || controller.signal.aborted) return undefined;
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
      if (this.active === controller) this.active = null;
      const next = this.pending;
      this.pending = null;
      if (next !== null && !this.disposed) this.launch(next);
    });
  }
}
