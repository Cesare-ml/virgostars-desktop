/**
 * A bounded, provider-independent scheduler for future VirgoStars Rust astronomy IPC.
 * This does NOT compute positions or call Tauri. A future, validated native
 * provider must explicitly implement CalculationTransport.
 */
export interface CalculationRequest<T> {
  readonly protocolVersion: 1;
  readonly sessionId: string;
  readonly requestSeq: number;
  readonly calculationKey: string;
  readonly input: T;
}
export interface CalculationResponse<T> {
  readonly protocolVersion: 1;
  readonly sessionId: string;
  readonly requestSeq: number;
  readonly calculationKey: string;
  readonly result: T;
}
export type CalculationErrorCode = 'CALCULATION_FAILED' | 'PROTOCOL_MISMATCH';
export interface CalculationTransport<I, O> {
  calculate(request: CalculationRequest<I>): Promise<CalculationResponse<O>>;
}
export interface CalculationObserver<O> {
  onResult(response: CalculationResponse<O>): void;
  onError?(error: CalculationErrorCode, request: CalculationRequest<unknown>): void;
}
export interface CalculationQueueState {
  readonly sessionId: string;
  readonly latestRequestSeq: number;
  readonly active: 0 | 1;
  readonly pending: 0 | 1;
  readonly disposed: boolean;
}
interface Queued<I> {
  readonly request: CalculationRequest<I>;
  readonly generation: number;
}
/**
 * One active async operation + one overwritten pending item. Even if Tauri's
 * invoke cannot truly abort an already-running Rust computation, no subsequent
 * invocations are started until that operation settles. Old results/errors
 * never reach the chart. submit() does not create a Promise for every tick.
 */
export class LatestCalculationScheduler<I, O> {
  private sessionId: string;
  private sequence = 0;
  private generation = 0;
  private active = false;
  private pending: Queued<I> | null = null;
  private disposed = false;
  private readonly transport: CalculationTransport<I, O>;
  private readonly observer: CalculationObserver<O>;

  constructor(sessionId: string, transport: CalculationTransport<I, O>, observer: CalculationObserver<O>) {
    if (!sessionId || sessionId.length > 128) throw new Error('Invalid session');
    this.sessionId = sessionId;
    this.transport = transport;
    this.observer = observer;
  }

  /** Returns only an ID; there are no per-tick Promises or response arrays. */
  submit(input: I, calculationKey: string): number | null {
    if (this.disposed) return null;
    if (!calculationKey || calculationKey.length > 128) throw new Error('Invalid calculation key');
    if (!Number.isSafeInteger(this.sequence + 1)) throw new Error('Request sequence exhausted');
    const request: CalculationRequest<I> = {
      protocolVersion: 1,
      sessionId: this.sessionId,
      requestSeq: ++this.sequence,
      calculationKey,
      input,
    };
    this.pending = {request, generation: this.generation};
    this.startNext();
    return request.requestSeq;
  }

  /** Hide an old chart's pending results on blur/cancel without starting extra work. */
  invalidate(): void {
    if (this.disposed) return;
    this.generation++;
    this.pending = null;
  }

  /** Invalidate every pending result when switching chart/workspace. */
  switchSession(sessionId: string): void {
    if (this.disposed) return;
    if (!sessionId || sessionId.length > 128) throw new Error('Invalid session');
    this.invalidate();
    this.sessionId = sessionId;
  }

  dispose(): void {
    if (this.disposed) return;
    this.invalidate();
    this.disposed = true;
  }

  get state(): CalculationQueueState {
    return {
      sessionId: this.sessionId,
      latestRequestSeq: this.sequence,
      active: this.active ? 1 : 0,
      pending: this.pending ? 1 : 0,
      disposed: this.disposed,
    };
  }

  private startNext(): void {
    if (this.active || !this.pending || this.disposed) return;
    const item = this.pending;
    this.pending = null;
    this.active = true;
    // Promise.resolve().then catches synchronous transport errors as well.
    void Promise.resolve()
      .then(() => this.transport.calculate(item.request))
      .then(response => {
        if (!this.isCurrent(item)) return;
        if (!this.isValidResponse(response, item.request)) {
          this.safeError('PROTOCOL_MISMATCH', item.request);
          return;
        }
        try { this.observer.onResult(response); } catch { /* UI callbacks must not kill the queue */ }
      })
      .catch(() => {
        if (this.isCurrent(item)) this.safeError('CALCULATION_FAILED', item.request);
      })
      .finally(() => {
        this.active = false;
        this.startNext();
      });
  }

  private isCurrent(item: Queued<I>): boolean {
    return !this.disposed &&
      item.generation === this.generation &&
      item.request.requestSeq === this.sequence &&
      item.request.sessionId === this.sessionId;
  }

  private isValidResponse(response: unknown, request: CalculationRequest<I>): response is CalculationResponse<O> {
    if (typeof response !== 'object' || response === null) return false;
    const r = response as Partial<CalculationResponse<O>>;
    return r.protocolVersion === 1 && r.sessionId === request.sessionId &&
      r.requestSeq === request.requestSeq && r.calculationKey === request.calculationKey &&
      Object.prototype.hasOwnProperty.call(r, 'result');
  }

  private safeError(error: CalculationErrorCode, request: CalculationRequest<I>): void {
    try { this.observer.onError?.(error, request); } catch { /* keep draining */ }
  }
}
