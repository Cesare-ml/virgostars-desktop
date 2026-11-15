import type {CivilTimeInput} from './civil-time';
import {resolveCivilTime} from './civil-time';
import {selectCivilInstant} from './civil-time-choice';
import type {CivilCalculationDispatchResult} from './civil-calculation-dispatch';
import {submitCivilCalculation} from './civil-calculation-dispatch';
import {
  LatestCalculationQueue,
  type CalculationOutcome,
  type CalculationPort,
  type SnapshotValidator,
} from './calculation-queue';

/**
 * Opt-in integration of the real latest-only queue with the civil-time gate.
 * This is NOT a production-ready astronomy adapter or an Angular component.
 */
export class CivilCalculationSession {
  private readonly queue: LatestCalculationQueue<never>;
  private disposed = false;

  constructor(
    sessionId: string,
    port: CalculationPort,
    notify: (outcome: CalculationOutcome<never>) => void,
  ) {
    // Until scientific validation is independently approved, even a native
    // ready-shaped response must be treated as invalid, never chart-ready.
    const denyUnverifiedReady: SnapshotValidator<never> = (_value): _value is never => false;
    this.queue = new LatestCalculationQueue(sessionId, port, denyUnverifiedReady, notify);
  }

  /**
   * A fresh form submission supersedes previous work even if invalid, nonexistent,
   * or needing a DST choice. Old replies cannot reappear while a user edits.
   */
  submit(
    input: CivilTimeInput,
    location: Readonly<{latMicro: number; lngMicro: number}>,
    calculationKey: string,
    selectedUtc: string | null = null,
  ): CivilCalculationDispatchResult {
    if (this.disposed) return {status:'queue_unavailable'};
    this.queue.invalidate();
    return submitCivilCalculation(
      input,
      (civil, utc) => selectCivilInstant(civil, resolveCivilTime, utc),
      location,
      calculationKey,
      this.queue,
      selectedUtc,
    );
  }

  /** UI must call this immediately on input edits, not only on submit. */
  invalidate(): void {
    if (!this.disposed) this.queue.invalidate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.queue.dispose();
  }
}
