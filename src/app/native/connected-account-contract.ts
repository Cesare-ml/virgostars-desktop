/**
 * Candidate v1 IPC contract for the Desktop connected-account login.
 *
 * The Rust host (not the Angular WebView) must own the PKCE verifier/state,
 * system-browser launch, loopback listener, token exchange and OS keychain.
 * No OAuth code, URL, token, verifier or state may cross this interface.
 * The registered Tauri command is currently a disabled-only stub. Even when
 * explicitly invoked, it cannot start a session or return native secrets.
 */
export type ConnectedAccountOperation =
  | Readonly<{ operation: 'start' }>
  | Readonly<{ operation: 'status'; attemptId: string }>
  | Readonly<{ operation: 'cancel'; attemptId: string }>;

export type ConnectedAccountResult =
  | Readonly<{ kind: 'disabled' | 'not_native' | 'native_unavailable' }>
  | Readonly<{ kind: 'pending'; attemptId: string; expiresInSeconds: number }>
  | Readonly<{ kind: 'connected'; attemptId: string; scope: 'chart_sync:read' }>
  | Readonly<{ kind: 'denied' | 'expired' | 'cancelled'; attemptId: string }>;

export interface ConnectedAccountTransport {
  isNative(): boolean;
  invoke(
    command: 'desktop_connected_account_v1',
    args: { request: Readonly<{ protocolVersion: 1; operation: string; attemptId?: string }> },
  ): Promise<unknown>;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ERROR = 'Invalid connected-account protocol';

function dataObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error(ERROR);
  return descriptor.value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length &&
    actual.every(key => typeof key === 'string' && keys.includes(key));
}

/**
 * The response is a data-only status notification, never a credential carrier.
 * Reject even unrecognized fields: a future native regression must not send
 * tokens, authorization codes, redirect URLs or the PKCE verifier to the UI.
 */
export function decodeConnectedAccountResponse(
  raw: unknown, operation: ConnectedAccountOperation,
): ConnectedAccountResult {
  if (!dataObject(raw) || ownData(raw, 'protocolVersion') !== 1) throw new Error(ERROR);
  const status = ownData(raw, 'status');
  // A native host that has not passed the staging security gates responds
  // with precisely these two fields. No synthetic ID/connection is invented.
  if (status === 'disabled' && exactKeys(raw, ['protocolVersion', 'status'])) {
    return Object.freeze({kind: 'disabled'});
  }
  const attemptId = ownData(raw, 'attemptId');
  if (typeof attemptId !== 'string' || !ID.test(attemptId) ||
      (operation.operation !== 'start' && attemptId !== operation.attemptId)) throw new Error(ERROR);

  if (status === 'pending' && operation.operation !== 'cancel' &&
      exactKeys(raw, ['protocolVersion', 'status', 'attemptId', 'expiresInSeconds'])) {
    const seconds = ownData(raw, 'expiresInSeconds');
    if (typeof seconds === 'number' && Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 600) {
      return Object.freeze({kind: 'pending', attemptId, expiresInSeconds: seconds});
    }
  }
  if (status === 'connected' && operation.operation === 'status' &&
      exactKeys(raw, ['protocolVersion', 'status', 'attemptId', 'scope'])) {
    const scope = ownData(raw, 'scope');
    if (scope === 'chart_sync:read') {
      return Object.freeze({kind: 'connected', attemptId, scope});
    }
  }
  if (status === 'denied' || status === 'expired' || status === 'cancelled') {
    const allowed = status === 'cancelled' ? operation.operation === 'cancel' : operation.operation === 'status';
    if (allowed && exactKeys(raw, ['protocolVersion', 'status', 'attemptId'])) {
      return Object.freeze({kind: status, attemptId});
    }
  }
  throw new Error(ERROR);
}

/**
 * Preview/default state is permanently inert. The explicit `enabled` option
 * only becomes meaningful after Rust implementation + staging security review.
 * It is deliberately not read from localStorage or any URL parameter.
 */
export async function requestConnectedAccount(
  transport: ConnectedAccountTransport,
  operation: ConnectedAccountOperation,
  options: Readonly<{enabled?: boolean}> = {},
): Promise<ConnectedAccountResult> {
  if (options.enabled !== true) return {kind: 'disabled'};
  try {
    if (!transport.isNative()) return {kind: 'not_native'};
    if (operation.operation !== 'start' &&
        (typeof operation.attemptId !== 'string' || !ID.test(operation.attemptId))) return {kind: 'native_unavailable'};
    if (operation.operation !== 'start' && operation.operation !== 'status' && operation.operation !== 'cancel') {
      return {kind: 'native_unavailable'};
    }
    const request = operation.operation === 'start'
      ? {protocolVersion: 1 as const, operation: 'start'}
      : {protocolVersion: 1 as const, operation: operation.operation, attemptId: operation.attemptId};
    const raw = await transport.invoke('desktop_connected_account_v1', {request});
    return decodeConnectedAccountResponse(raw, operation);
  } catch {
    // Native paths, HTTP errors and private account information never reach UI.
    return {kind: 'native_unavailable'};
  }
}
