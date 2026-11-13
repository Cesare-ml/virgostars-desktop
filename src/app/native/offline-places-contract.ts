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
  | Readonly<{kind: 'query_too_short' | 'query_too_long' | 'not_native' | 'busy' | 'catalog_unavailable' | 'unavailable' | 'stale'; items: readonly []}>;

/**
 * Preflight for Rust's bounded FTS5 query. We approximate its Unicode
 * alphanumeric/underscore token boundaries for immediate UI feedback.
 * Rust remains the authoritative validator for every caller.
 */
export function offlinePlaceQueryProblem(query: string): 'query_too_short' | 'query_too_long' | null {
  const characters = [...query];
  if (characters.length > 80) return 'query_too_long';
  const alphanumeric = characters.filter(char => /[\p{L}\p{N}]/u.test(char)).length;
  if (alphanumeric < 2) return 'query_too_short';
  const terms = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return terms.length > 5 ? 'query_too_long' : null;
}

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
    const problem = offlinePlaceQueryProblem(query);
    if (problem) return {kind: problem, items: []};
    try {
      if (!this.transport.isNative()) return {kind: 'not_native', items: []};
      const raw = await this.transport.invoke('search_offline_places', {query, limit});
      if (ticket !== this.generation || this.disposed) return {kind: 'stale', items: []};
      return {kind: 'ready', items: decodeOfflinePlaceResults(raw)};
    } catch (error: unknown) {
      if (ticket !== this.generation || this.disposed) return {kind: 'stale', items: []};
      const code = String(error);
      if (code === 'PLACE_SEARCH_BUSY') return {kind: 'busy', items: []};
      if (code === 'PLACE_CATALOG_UNAVAILABLE') return {kind: 'catalog_unavailable', items: []};
      // Never propagate Rust file paths, SQL texts, stack traces or user data.
      return {kind: 'unavailable', items: []};
    }
  }
  clear(): void { this.generation++; }
  dispose(): void { this.disposed = true; this.clear(); }
}
