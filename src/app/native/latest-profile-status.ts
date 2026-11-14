/**
 * UI-only generation guard for a future asynchronous encrypted-profile status
 * reader. No identity, account data, keys, network requests or native IPC.
 * This is never an authorization or encryption boundary.
 */
export class LatestProfileStatus<TDecision> {
  private token: symbol | null = null;
  private revision = 0;
  private disposed = false;
  private current: TDecision;
  private readonly assess: (evidence: unknown) => TDecision;
  private readonly denied: TDecision;

  constructor(assess: (evidence: unknown) => TDecision, denied: TDecision) {
    this.assess = assess;
    this.denied = denied;
    this.current = denied;
  }

  get decision(): TDecision { return this.current; }

  /**
   * Starts a status read, immediately hiding any previously visible profile.
   * Tokens are opaque and unique even across separate profile-view instances.
   */
  begin(): symbol | null {
    if (this.disposed) return null;
    this.revision++;
    this.current = this.denied;
    return (this.token = Symbol('profile-status'));
  }

  /**
   * Only the newest pending read may publish a result, and only once.
   * Rejected/invalid input should be mapped to a blocked decision by assess.
   * An assessor exception also fails closed. Errors are never logged.
   */
  complete(token: unknown, evidence: unknown): boolean {
    if (this.disposed || typeof token !== 'symbol' || token !== this.token) return false;
    const revision = this.revision;
    this.token = null; // consume before invoking possibly reentrant assessment
    this.current = this.denied;
    let evaluated: TDecision;
    try { evaluated = this.assess(evidence); }
    catch { return true; }
    // Assessors can invoke begin/invalidate/dispose synchronously; never
    // revive a previous view if its status epoch changed during assessment.
    if (this.disposed || revision !== this.revision) return false;
    this.current = evaluated;
    return true;
  }

  /** Lock/logout/account change: previous decisions and completions are void. */
  invalidate(): void {
    this.revision++;
    this.token = null;
    this.current = this.denied;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidate();
  }
}
