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
  if (!record(payload) || payload['protocolVersion'] !== 1 ||
      payload['product'] !== 'VirgoStars Desktop' ||
      typeof payload['applicationVersion'] !== 'string' ||
      !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.+-]+)?$/.test(payload['applicationVersion']) ||
      (payload['platform'] !== 'windows' &&
       payload['platform'] !== 'macos' &&
       payload['platform'] !== 'linux') ||
      payload['fixtureKind'] !== 'synthetic_demo' ||
      payload['accountConnected'] !== false ||
      payload['cloudSyncAvailable'] !== false ||
      payload['ephemerisReady'] !== false) {
    throw new Error('Unsupported or invalid desktop runtime protocol');
  }
  return {
    protocolVersion: 1,
    product: 'VirgoStars Desktop',
    applicationVersion: payload['applicationVersion'],
    platform: payload['platform'],
    fixtureKind: 'synthetic_demo',
    accountConnected: false,
    cloudSyncAvailable: false,
    ephemerisReady: false,
  };
}

/** Explicit dependency injection makes error and browser paths locally testable. */
export async function probeDesktopRuntime(transport: RuntimeProbeTransport): Promise<RuntimeProbeResult> {
  try {
    if (!transport.isNative()) return { kind: 'browser_preview', info: null };
    return { kind: 'desktop_demo', info: decodeDesktopRuntimeInfo(await transport.invoke('desktop_runtime_info')) };
  } catch {
    // Do not expose filesystem, IPC or private environment details to UI or logs.
    return { kind: 'native_unavailable', info: null };
  }
}
