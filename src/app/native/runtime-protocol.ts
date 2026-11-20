/**
 * Contract v1 for a read-only local Tauri health/capability probe.
 * A validated probe MUST NOT be confused with account login or astronomical readiness.
 */
export interface DesktopRuntimeInfoV1 {
  readonly protocolVersion: 1;
  readonly product: 'VirgoStars Desktop';
  readonly applicationVersion: string;
  readonly platform: 'windows' | 'macos' | 'linux';
  readonly fixtureKind: 'synthetic_demo';
  readonly accountConnected: false;
  readonly cloudSyncAvailable: false;
  readonly ephemerisReady: false;
}

export type RuntimeProbeResult =
  | Readonly<{ kind: 'browser_preview'; info: null }>
  | Readonly<{ kind: 'desktop_demo'; info: DesktopRuntimeInfoV1 }>
  | Readonly<{ kind: 'native_unavailable'; info: null }>;

export interface RuntimeProbeTransport {
  readonly isNative: () => boolean;
  readonly invoke: (command: 'desktop_runtime_info') => Promise<unknown>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function decodeDesktopRuntimeInfo(payload: unknown): DesktopRuntimeInfoV1 {
  try {
    if (!record(payload)) throw new Error('Invalid runtime response');
    // IPC replies are untrusted objects. Read each field once so an accessor or
    // mutable transport result cannot change between validation and display.
    const protocolVersion = payload['protocolVersion'];
    const product = payload['product'];
    const applicationVersion = payload['applicationVersion'];
    const platform = payload['platform'];
    const fixtureKind = payload['fixtureKind'];
    const accountConnected = payload['accountConnected'];
    const cloudSyncAvailable = payload['cloudSyncAvailable'];
    const ephemerisReady = payload['ephemerisReady'];
    if (protocolVersion !== 1 || product !== 'VirgoStars Desktop' ||
        typeof applicationVersion !== 'string' || applicationVersion.length > 64 ||
        !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.+-]+)?$/.test(applicationVersion) ||
        (platform !== 'windows' && platform !== 'macos' && platform !== 'linux') ||
        fixtureKind !== 'synthetic_demo' ||
        accountConnected !== false || cloudSyncAvailable !== false || ephemerisReady !== false) {
      throw new Error('Invalid runtime response');
    }
    // Return only the reviewed v1 fields; keep the trusted result detached
    // from, and immutable despite later mutations of, the untrusted payload.
    return Object.freeze({
      protocolVersion: 1,
      product: 'VirgoStars Desktop',
      applicationVersion,
      platform,
      fixtureKind: 'synthetic_demo',
      accountConnected: false,
      cloudSyncAvailable: false,
      ephemerisReady: false,
    });
  } catch {
    // A malicious/throwing accessor cannot leak its exception text to callers.
    throw new Error('Unsupported or invalid desktop runtime protocol');
  }
}

/**
 * A missing native IPC reply must never leave the Angular footer in "checking"
 * forever. The timer is local-only: no network retries, background polling or
 * ability to infer account/auth readiness.
 */
export interface RuntimeProbeTimers {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export interface RuntimeProbeOptions {
  readonly timeoutMs?: number;
  readonly timers?: RuntimeProbeTimers;
}

const defaultProbeTimers: RuntimeProbeTimers = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const DEFAULT_TIMEOUT_MS = 4000;
const MAX_TIMEOUT_MS = 30000;

/**
 * Use only the read-only local IPC command. A timed-out invocation can still
 * complete inside Tauri, but its late result cannot change this settled result.
 */
export async function probeDesktopRuntime(
  transport: RuntimeProbeTransport, options: RuntimeProbeOptions = {},
): Promise<RuntimeProbeResult> {
  let scheduled = false;
  let handle: unknown;
  let timers: RuntimeProbeTimers | undefined;
  try {
    if (!transport.isNative()) return { kind: 'browser_preview', info: null };
    // Resolve configurable timer hooks inside the error boundary and only for
    // native mode. Invalid or throwing hooks must not escape as raw errors.
    timers = options?.timers ?? defaultProbeTimers;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
      throw new Error('Invalid native runtime probe timeout');
    }
    // Create the deadline promise first, then register its timer *outside* the
    // Promise constructor. Constructor exceptions reject a promise rather than
    // throwing synchronously, which could otherwise start unbounded native IPC.
    let rejectTimeout!: (reason: Error) => void;
    let firedSynchronously = false;
    const timeout = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
    });
    // If a broken scheduler calls back and then throws, its rejection still
    // needs an observer even though no Promise.race will be installed.
    void timeout.catch(() => {});
    handle = timers.set(() => {
      firedSynchronously = true;
      rejectTimeout(new Error('Native runtime probe timeout'));
    }, timeoutMs);
    // A scheduler returning no cancellation handle cannot prove it installed
    // the required deadline. Never dispatch an unbounded native call.
    if (handle == null) throw new Error('Native runtime probe deadline unavailable');
    scheduled = true;
    if (firedSynchronously) throw new Error('Native runtime probe timeout');
    const invocation = Promise.resolve().then(() => transport.invoke('desktop_runtime_info'));
    const payload = await Promise.race([invocation, timeout]);
    return { kind: 'desktop_demo', info: decodeDesktopRuntimeInfo(payload) };
  } catch {
    // Do not expose local file paths, IPC errors or untrusted response details.
    return { kind: 'native_unavailable', info: null };
  } finally {
    if (scheduled && timers) {
      try { timers.clear(handle); } catch { /* diagnostic never leaks timer failures */ }
    }
  }
}
