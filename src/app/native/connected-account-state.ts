import type { ConnectedAccountOperation, ConnectedAccountResult } from './connected-account-contract';

export type AccountViewStatus = 'idle' | 'restoring' | 'starting' | 'pending' | 'connected' | 'canceling' | 'expired' | 'offline' | 'denied' | 'failed' | 'unavailable' | 'signout_failed';
type Request = (operation: ConnectedAccountOperation) => Promise<ConnectedAccountResult>;

/** UI-only lifecycle: the native process retains every credential. */
export class ConnectedAccountState {
  status: AccountViewStatus = 'idle';
  remainingSeconds = 0;
  persistent = false;
  /** Native confirmed a stored credential exists; it is not proof of an online session. */
  hasRestorableSession = false;
  scope: import('./connected-account-contract').ConnectedAccountScope | null = null;
  private attemptId: string | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cancelStarting = false;
  private destroyed = false;
  private readonly request: Request;
  private readonly changed: () => void;

  /** Public correlation ID only while connected; never an access credential. */
  get connectedAttemptId(): string | null { return this.status === 'connected' ? this.attemptId : null; }
  get canRetryRestore(): boolean { return (this.status === 'unavailable' && this.attemptId === null) || this.status === 'expired' || this.status === 'offline'; }

  constructor(request: Request, changed: () => void) {
    this.request = request;
    this.changed = changed;
  }

  private update(status: AccountViewStatus, seconds = 0): void {
    if (this.destroyed) return;
    if (status !== 'connected') { this.scope = null; this.persistent = false; }
    this.status = status;
    this.remainingSeconds = seconds;
    this.changed();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  async restore(): Promise<void> {
    if (this.destroyed || this.status !== 'idle') return;
    const generation = ++this.generation;
    this.cancelStarting = false;
    this.update('restoring');
    const result = await this.request({operation:'restore'});
    if (result.kind === 'pending' && (this.destroyed || this.cancelStarting || generation !== this.generation)) {
      await this.request({operation:'cancel',attemptId:result.attemptId});
      await this.request({operation:'disconnect',attemptId:result.attemptId});
      if (!this.destroyed && generation === this.generation) this.update('idle');
      return;
    }
    if (this.destroyed || generation !== this.generation) return;
    if (result.kind === 'pending') {
      this.attemptId = result.attemptId;
      this.hasRestorableSession = true;
      this.update('pending',result.expiresInSeconds);
      this.schedule(generation);
    } else if (result.kind === 'idle' || result.kind === 'disabled' || result.kind === 'not_native') {
      this.hasRestorableSession = false;
      this.update('idle');
    }
    else this.update('unavailable');
  }

  async retryRestore(): Promise<void> {
    if (!this.canRetryRestore || this.destroyed) return;
    ++this.generation;
    if (this.attemptId) {
      const id = this.attemptId;
      this.clearTimer();
      this.update('canceling');
      const result = await this.request({operation:'disconnect',attemptId:id});
      if (this.destroyed || this.attemptId !== id) return;
      if (result.kind !== 'disconnected') { this.update('unavailable'); return; }
      this.attemptId = null;
    }
    this.update('idle');
    await this.restore();
  }

  async start(): Promise<void> {
    if (this.destroyed || ['restoring', 'starting', 'pending', 'connected', 'canceling'].includes(this.status)) return;
    this.hasRestorableSession = false;
    const generation = ++this.generation;
    this.cancelStarting = false;
    this.clearTimer();
    this.update('starting');
    if (this.attemptId) {
      const old = await this.request({operation:'signout', attemptId:this.attemptId});
      if (this.destroyed || generation !== this.generation) return;
      if (old.kind !== 'disconnected') { this.update('signout_failed'); return; }
      this.attemptId = null;
      if (this.cancelStarting) { this.update('idle'); return; }
    }
    const launchTimer = setTimeout(() => {
      if (!this.destroyed && generation === this.generation) {
        this.cancelStarting = true;
        this.update('expired');
      }
    }, 600_000);
    this.timer = launchTimer;
    const result = await this.request({operation:'start'});
    if (this.timer === launchTimer) this.clearTimer();
    if (result.kind === 'pending') {
      if (this.destroyed || this.cancelStarting || generation !== this.generation) {
        await this.request({operation:'cancel', attemptId:result.attemptId});
        const disconnected = await this.request({operation:'disconnect', attemptId:result.attemptId});
        if (!this.destroyed && generation === this.generation) {
          if (disconnected.kind !== 'disconnected') {
            this.attemptId = result.attemptId;
            this.update('unavailable');
          } else if (this.status !== 'expired') this.update('idle');
        }
        return;
      }
      this.attemptId = result.attemptId;
      this.update('pending', result.expiresInSeconds);
      this.schedule(generation);
      return;
    }
    if (!this.destroyed && generation === this.generation && this.status !== 'expired') {
      this.update(this.cancelStarting ? 'idle' : 'unavailable');
    }
  }

  private schedule(generation: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => { void this.poll(generation); }, 1500);
  }

  private async poll(generation: number): Promise<void> {
    const attemptId = this.attemptId;
    if (this.destroyed || generation !== this.generation || !attemptId) return;
    const result = await this.request({operation:'status', attemptId});
    if (this.destroyed || generation !== this.generation || this.attemptId !== attemptId) return;
    if (result.kind === 'pending') { this.update('pending', result.expiresInSeconds); this.schedule(generation); return; }
    if (result.kind === 'connected') { this.scope = result.scope; this.persistent = result.persistent === true; this.hasRestorableSession = this.persistent || this.hasRestorableSession; this.update('connected'); this.schedule(generation); return; }
    if (result.kind === 'offline') {
      this.update('offline');
      this.clearTimer();
      this.timer = setTimeout(() => { if (this.status === 'offline') void this.retryRestore(); }, 30_000);
      return;
    }
    if (result.kind === 'expired' || result.kind === 'denied' || result.kind === 'failed') { this.update(result.kind); return; }
    if (result.kind === 'cancelled' || result.kind === 'disconnected') { this.update('idle'); return; }
    this.update('unavailable');
  }

  async cancel(): Promise<void> {
    if (this.destroyed) return;
    if (this.status === 'starting' || this.status === 'restoring') {
      this.cancelStarting = true;
      this.update('canceling');
      return;
    }
    const attemptId = this.attemptId;
    if (!attemptId || !['pending', 'connected', 'expired', 'offline', 'denied', 'failed', 'unavailable', 'signout_failed'].includes(this.status)) return;
    const generation = ++this.generation;
    this.clearTimer();
    const wasPending = this.status === 'pending';
    this.update('canceling');
    if (wasPending) await this.request({operation:'cancel', attemptId});
    const result = await this.request({operation:wasPending ? 'disconnect' : 'signout', attemptId});
    if (this.destroyed || generation !== this.generation) return;
    if (result.kind === 'disconnected') { this.attemptId = null; this.hasRestorableSession = false; this.update('idle'); }
    else this.update(wasPending ? 'unavailable' : 'signout_failed');
  }

  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelStarting = true;
    ++this.generation;
    this.clearTimer();
    if (this.attemptId && this.status === 'pending') void this.request({operation:'cancel', attemptId:this.attemptId});
  }
}
