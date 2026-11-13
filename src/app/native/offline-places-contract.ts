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

/** Mirrors the Rust read-only FTS query gate: at least two Unicode letters or numbers,
 * with no more than 80 Unicode scalar values. No FTS syntax is constructed here. */
function validPlaceQuery(query: string): boolean {
  if ([...query].length > 80) return false;
  let lettersOrNumbers = 0;
  for (const character of query) {
    if (/[\p{L}\p{N}]/u.test(character) && ++lettersOrNumbers >= 2) return true;
  }
  return false;
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

  constructor(transport: PlaceSearchTransport) { this.transport = transport; }

  async search(query: string, limit = 12): Promise<PlaceQueryState> {
    if (this.disposed) return {kind: 'stale', items: []};
    const ticket = ++this.generation;
    if (!Number.isInteger(limit) || limit < 1 || limit > 30) {
      return {kind: 'unavailable', items: []};
    }
    if (!validPlaceQuery(query)) {
      return {kind: 'query_too_short', items: []};
    }
    try {
      if (!this.transport.isNative()) return {kind: 'not_native', items: []};
      const raw = await this.transport.invoke('search_offline_places', {query, limit});
      if (ticket !== this.generation || this.disposed) return {kind: 'stale', items: []};
      const items = decodeOfflinePlaceResults(raw);
      // Never show more native rows than this specific caller requested.
      if (items.length > limit) return {kind: 'unavailable', items: []};
      return {kind: 'ready', items};
    } catch (error: unknown) {
      if (ticket !== this.generation || this.disposed) return {kind: 'stale', items: []};
      // Rust returns exact string error codes. Do not coerce arbitrary native
      // rejection objects: custom toString/valueOf can throw or have side effects.
      if (error === 'PLACE_SEARCH_BUSY') return {kind: 'busy', items: []};
      if (error === 'PLACE_CATALOG_UNAVAILABLE') return {kind: 'catalog_unavailable', items: []};
      // Never propagate Rust file paths, SQL texts, stack traces or user data.
      return {kind: 'unavailable', items: []};
    }
  }
  clear(): void { this.generation++; }
  dispose(): void { this.disposed = true; this.clear(); }
}
