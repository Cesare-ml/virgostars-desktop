/**
 * Guest/offline scheduling boundary for a future native VirgoStars-Ephemeris port.
 * NO astronomical algorithms, fabricated sky positions, or Tauri invocation here.
 */
export type CalculationIntent = 'now' | 'scrub' | 'preview' | 'committed' | 'transit';

export interface CalculationDraftV1 {
  readonly intent: CalculationIntent;
  /** Canonical UTC instant, never a locale-dependent civil-time string. */
  readonly utcIso: string;
  readonly latMicro: number;
  readonly lngMicro: number;
  readonly timeZone: string;
  /** Stable fingerprint of ALL calculation-affecting inputs (produced by caller). */
  readonly calculationKey: string;
}
export interface CalculationRequestV1 extends CalculationDraftV1 {
  readonly protocolVersion: 1;
  readonly sessionId: string;
  readonly requestSeq: number;
}
export type CalculationOutcome<T> =
  | Readonly<{kind: 'ready'; request: CalculationRequestV1; value: T; providerVersion: string}>
  | Readonly<{kind: 'unavailable' | 'unsupported' | 'invalid_reply' | 'transport_error'; request: CalculationRequestV1}>;

export type CalculationPort = (request: CalculationRequestV1, signal: AbortSignal) => Promise<unknown>;
export type SnapshotValidator<T> = (value: unknown) => value is T;

const isObject = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);

// Cache only the last verified IANA ID: no unbounded city/zone map in the UI.
let lastValidZone = '';
function validIanaZone(zone: string): boolean {
  if (zone === lastValidZone) return true;
  try { new Intl.DateTimeFormat('en-US', {timeZone: zone}); }
  catch { return false; }
  lastValidZone = zone;
  return true;
}

/**
 * Detach the six request fields exactly once from potentially mutable UI input.
 * Accessors/proxies can throw or change values between validation and enqueue;
 * neither behavior may bypass preflight or cancel an existing valid request.
 */
function snapshotCalculationDraft(draft: CalculationDraftV1): CalculationDraftV1 | null {
  if (!isObject(draft)) return null;
  try {
    return {
      intent: draft.intent, utcIso: draft.utcIso, latMicro: draft.latMicro,
      lngMicro: draft.lngMicro, timeZone: draft.timeZone,
      calculationKey: draft.calculationKey,
    };
  } catch {
    return null;
  }
}

/** Validate only detached primitives, never read original draft fields again. */
function validDraftSnapshot(draft: CalculationDraftV1): boolean {
  if (!['now','scrub','preview','committed','transit'].includes(draft.intent)) return false;
  if (typeof draft.utcIso !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(draft.utcIso)) return false;
  const epoch = Date.parse(draft.utcIso);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== draft.utcIso) return false;
  if (!Number.isSafeInteger(draft.latMicro) || Math.abs(draft.latMicro) > 90_000_000 ||
      !Number.isSafeInteger(draft.lngMicro) || Math.abs(draft.lngMicro) > 180_000_000) return false;
  if (typeof draft.timeZone !== 'string' || draft.timeZone.length < 1 || draft.timeZone.length > 80 ||
      !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(draft.timeZone)) return false;
  if (!validIanaZone(draft.timeZone)) return false;
  if (typeof draft.calculationKey !== 'string' || draft.calculationKey.length < 1 ||
      draft.calculationKey.length > 128 || !/^[A-Za-z0-9_.:\-]+$/.test(draft.calculationKey)) return false;
  return true;
}

/** Reject unsupported time/location inputs before scheduling native work. */
export function validCalculationDraft(draft: CalculationDraftV1): boolean {
  const snapshot = snapshotCalculationDraft(draft);
  return snapshot !== null && validDraftSnapshot(snapshot);
}

/** Verify correlation metadata and status before exposing an untrusted port reply. */
export function decodeCalculationReply<T>(
  raw: unknown, request: CalculationRequestV1, validate: SnapshotValidator<T>
): CalculationOutcome<T> {
  if (!isObject(raw) || raw.protocolVersion !== 1 || raw.sessionId !== request.sessionId ||
      raw.requestSeq !== request.requestSeq || raw.calculationKey !== request.calculationKey) {
    return {kind:'invalid_reply',request};
  }
  if (raw.status === 'unavailable' || raw.status === 'unsupported') {
    // Explicitly do not forward accidentally bundled data on an unsupported result.
    return {kind: raw.status, request};
  }
  if (raw.status !== 'ready' || typeof raw.providerVersion !== 'string' ||
      raw.providerVersion.length < 1 || raw.providerVersion.length > 100 ||
      !validate(raw.snapshot)) return {kind:'invalid_reply',request};
  return {kind:'ready',request,value:raw.snapshot,providerVersion:raw.providerVersion};
}

/**
 * At most one active port call and one replaceable pending request per queue.
 * An AbortSignal asks the provider to stop; even when ignored, stale replies
 * never reach the consumer. No retries, timers, network calls, or cache.
 */
export class LatestCalculationQueue<T> {
  private readonly port: CalculationPort;
  private readonly validate: SnapshotValidator<T>;
  private readonly notify: (outcome: CalculationOutcome<T>) => void;
  private readonly sessionId: string;
  private nextSeq = 0;
  private active = false;
  private activeController: AbortController | null = null;
  private pending: CalculationRequestV1 | null = null;
  private generation = 0;
  private disposed = false;

  constructor(sessionId: string, port: CalculationPort, validate: SnapshotValidator<T>,
    notify: (outcome: CalculationOutcome<T>) => void) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(sessionId)) throw new Error('Invalid calculation session');
    this.sessionId = sessionId;
    this.port = port;
    this.validate = validate;
    this.notify = notify;
  }

  /** Invalid drafts do not affect an existing valid request. */
  submit(draft: CalculationDraftV1): number | null {
    if (this.disposed || this.nextSeq >= Number.MAX_SAFE_INTEGER) return null;
    const snapshot = snapshotCalculationDraft(draft);
    if (snapshot === null || !validDraftSnapshot(snapshot)) return null;
    const request: CalculationRequestV1 = {
      protocolVersion: 1, sessionId: this.sessionId, requestSeq: ++this.nextSeq,
      intent: snapshot.intent, utcIso: snapshot.utcIso, latMicro: snapshot.latMicro,
      lngMicro: snapshot.lngMicro, timeZone: snapshot.timeZone,
      calculationKey: snapshot.calculationKey,
    };
    this.generation++;
    if (this.active) {
      this.pending = request;
      this.activeController?.abort();
    } else {
      this.launch(request);
    }
    return request.requestSeq;
  }

  /** Use on chart/mode changes, account switches, or while leaving the view. */
  invalidate(): void {
    this.generation++;
    this.pending = null;
    this.activeController?.abort();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidate();
  }

  private launch(request: CalculationRequestV1): void {
    if (this.disposed) return;
    this.active = true;
    const generation = this.generation;
    const controller = new AbortController();
    this.activeController = controller;
    // Superseding a request or closing the view can happen before this microtask
    // executes. Do not start abandoned native work or decode an obsolete payload.
    const isCurrent = (): boolean => !this.disposed && !controller.signal.aborted &&
      generation === this.generation && request.requestSeq === this.nextSeq;
    void Promise.resolve().then(() => {
      if (!isCurrent()) return undefined;
      return this.port(request, controller.signal);
    }).then(
      raw => {
        if (!isCurrent()) return;
        try {
          this.deliver(request, generation, decodeCalculationReply(raw, request, this.validate));
        } catch {
          // A future provider's custom validator may throw on malformed IPC.
          // Keep the error private and let the queue recover for later requests.
          this.deliver(request, generation, {kind:'invalid_reply', request});
        }
      },
      () => {
        if (isCurrent()) this.deliver(request, generation, {kind:'transport_error',request});
      },
    ).finally(() => {
      this.active = false;
      this.activeController = null;
      const next = this.pending;
      this.pending = null;
      if (next && !this.disposed) this.launch(next);
    });
  }

  private deliver(request: CalculationRequestV1, generation: number, result: CalculationOutcome<T>): void {
    if (this.disposed || generation !== this.generation || request.requestSeq !== this.nextSeq) return;
    // Subscriber errors must not corrupt the queue or fabricate a port error.
    try { this.notify(result); } catch { /* consumer owns its own diagnostics */ }
  }
}
