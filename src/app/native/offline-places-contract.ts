/**
 * Read-only offline city search contract shared with the Rust Tauri command.
 * Only bounded result lists cross IPC. City sources stay on local disk.
 */
export interface OfflinePlaceV1 {
  readonly id: number;
  readonly name: string;
  readonly italianName: string | null;
  readonly latMicro: number;
  readonly lngMicro: number;
  readonly population: number | null;
  readonly stateId: number | null;
  readonly region: string | null;
  readonly timeZone: string | null;
  readonly countryName: string | null;
  readonly countryCode: string | null;
}

export type PlaceQueryState =
  | Readonly<{kind: 'ready'; items: readonly OfflinePlaceV1[]}>
  | Readonly<{kind: 'query_too_short' | 'not_native' | 'busy' | 'catalog_unavailable' | 'unavailable' | 'stale'; items: readonly []}>;

export interface PlaceSearchTransport {
  isNative(): boolean;
  invoke(command: 'search_offline_places', args: {query: string; limit: number}): Promise<unknown>;
}

/** A hung local IPC must not leave the picker permanently in loading state. */
export interface PlaceSearchTimers {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export const PLACE_SEARCH_TIMEOUT_MS = 5000;
const SYSTEM_TIMERS: PlaceSearchTimers = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Never start native work if the deadline could not be installed safely. */
async function invokeBounded(
  invoke: () => Promise<unknown>, timers: PlaceSearchTimers,
): Promise<unknown> {
  let rejectDeadline!: (reason: Error) => void;
  let expired = false;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  // Broken injected schedulers may fire and then throw before Promise.race exists.
  void deadline.catch(() => {});
  const handle = timers.set(() => {
    expired = true;
    rejectDeadline(new Error('Offline place search deadline exceeded'));
  }, PLACE_SEARCH_TIMEOUT_MS);
  if (handle === null || handle === undefined) {
    throw new Error('Offline place search deadline unavailable');
  }
  try {
    if (expired) throw new Error('Offline place search deadline exceeded');
    return await Promise.race([Promise.resolve().then(invoke), deadline]);
  } finally {
    try { timers.clear(handle); } catch { /* A broken timer cannot change the search result. */ }
  }
}

function object(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
function optionalString(x: unknown): x is string | null {
  return x === null || (typeof x === 'string' && x.length <= 255);
}
function int(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x);
}
function optionalInt(x: unknown): x is number | null {
  return x === null || int(x);
}

export function decodeOfflinePlaceResults(raw: unknown): readonly OfflinePlaceV1[] {
  if (!object(raw) || raw['protocolVersion'] !== 1 || !Array.isArray(raw['items']) ||
      raw['items'].length > 30) {
    throw new Error('Invalid offline place protocol');
  }
  const ids = new Set<number>();
  return raw['items'].map((input: unknown) => {
    if (!object(input)) throw new Error('Invalid offline place record');
    // v1 packs do not include the optional country lookup.
    const countryName = input['countryName'] ?? null;
    const countryCode = input['countryCode'] ?? null;
    if (
        !int(input['id']) || input['id'] <= 0 || ids.has(input['id']) ||
        typeof input['name'] !== 'string' || !input['name'].trim() || input['name'].length > 255 ||
        !optionalString(input['italianName']) ||
        !int(input['latMicro']) || Math.abs(input['latMicro']) > 90_000_000 ||
        !int(input['lngMicro']) || Math.abs(input['lngMicro']) > 180_000_000 ||
        !optionalInt(input['population']) || (input['population'] !== null && input['population'] < 0) ||
        !optionalInt(input['stateId']) || (input['stateId'] !== null && input['stateId'] < 0) ||
        !optionalString(input['region']) || !optionalString(input['timeZone']) ||
        !optionalString(countryName) ||
        !(countryCode === null || (typeof countryCode === 'string' && /^[A-Z]{2}$/.test(countryCode)))) {
      throw new Error('Invalid offline place record');
    }
    ids.add(input['id']);
    return {
      id: input['id'], name: input['name'], italianName: input['italianName'],
      latMicro: input['latMicro'], lngMicro: input['lngMicro'],
      population: input['population'], stateId: input['stateId'],
      region: input['region'], timeZone: input['timeZone'],
      countryName, countryCode,
    };
  });
}

/**
 * Latest request wins. The view can update the typed search text immediately,
 * while all stale native results/errors are ignored.
 * Caller should debounce input (e.g. 120 ms) before invoking this method.
 */
export class OfflinePlaceSearch {
  private generation = 0;
  private disposed = false;
  private readonly transport: PlaceSearchTransport;
  private readonly timers: PlaceSearchTimers;

  constructor(transport: PlaceSearchTransport, timers: PlaceSearchTimers = SYSTEM_TIMERS) {
    this.transport = transport;
    this.timers = timers;
  }

  async search(query: string, limit = 12): Promise<PlaceQueryState> {
    if (this.disposed) return {kind: 'stale', items: []};
    const ticket = ++this.generation;
    if (!Number.isInteger(limit) || limit < 1 || limit > 30) {
      return {kind: 'unavailable', items: []};
    }
    if (query.trim().length < 2 || [...query].length > 80) {
      return {kind: 'query_too_short', items: []};
    }
    try {
      if (!this.transport.isNative()) return {kind: 'not_native', items: []};
      const raw = await invokeBounded(
        () => this.transport.invoke('search_offline_places', {query, limit}), this.timers,
      );
      if (ticket !== this.generation || this.disposed) return {kind: 'stale', items: []};
      return {kind: 'ready', items: decodeOfflinePlaceResults(raw)};
    } catch (error: unknown) {
      if (ticket !== this.generation || this.disposed) return {kind: 'stale', items: []};
      let code = '';
      // Tauri normally rejects with a string. Accept Error.message too, but
      // never coerce arbitrary thrown values (their conversion may throw or
      // masquerade as an official native status).
      try {
        if (typeof error === 'string') code = error;
        else if (error instanceof Error && typeof error.message === 'string') code = error.message;
      } catch { /* Malformed native rejection is simply unavailable. */ }
      if (code === 'PLACE_SEARCH_BUSY') return {kind: 'busy', items: []};
      if (code === 'PLACE_CATALOG_UNAVAILABLE') return {kind: 'catalog_unavailable', items: []};
      // Never propagate Rust file paths, SQL texts, stack traces or user data.
      return {kind: 'unavailable', items: []};
    }
  }
  clear(): void { this.generation++; }
  dispose(): void { this.disposed = true; this.clear(); }
}
