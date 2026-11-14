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

/** Read only ordinary own data properties of the native JSON reply. */
function ownData(value: object, key: string, optional = false): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) {
    if (optional) return null;
    throw new Error('Invalid offline place protocol');
  }
  if (!('value' in descriptor)) throw new Error('Invalid offline place protocol');
  return optional ? descriptor.value ?? null : descriptor.value;
}

export function decodeOfflinePlaceResults(raw: unknown): readonly OfflinePlaceV1[] {
  try {
    if (!object(raw)) throw new Error('Invalid offline place protocol');
    const version = ownData(raw, 'protocolVersion');
    const items = ownData(raw, 'items');
    if (version !== 1 || !Array.isArray(items) || items.length > 30) {
      throw new Error('Invalid offline place protocol');
    }
    const ids = new Set<number>();
    const result: OfflinePlaceV1[] = [];
    // Never use Array.map: sparse arrays skip holes and can return a fake "ready" result.
    for (let i = 0; i < items.length; i++) {
      const input = ownData(items, String(i));
      if (!object(input)) throw new Error('Invalid offline place protocol');
      const id = ownData(input, 'id');
      const name = ownData(input, 'name');
      const italianName = ownData(input, 'italianName');
      const latMicro = ownData(input, 'latMicro');
      const lngMicro = ownData(input, 'lngMicro');
      const population = ownData(input, 'population');
      const stateId = ownData(input, 'stateId');
      const region = ownData(input, 'region');
      const timeZone = ownData(input, 'timeZone');
      // v1 packs do not include these v2 country-lookup fields.
      const countryName = ownData(input, 'countryName', true);
      const countryCode = ownData(input, 'countryCode', true);
      if (
          !int(id) || id <= 0 || ids.has(id) ||
          typeof name !== 'string' || !name.trim() || name.length > 255 ||
          !optionalString(italianName) ||
          !int(latMicro) || Math.abs(latMicro) > 90_000_000 ||
          !int(lngMicro) || Math.abs(lngMicro) > 180_000_000 ||
          !optionalInt(population) || (population !== null && population < 0) ||
          !optionalInt(stateId) || (stateId !== null && stateId < 0) ||
          !optionalString(region) || !optionalString(timeZone) ||
          !optionalString(countryName) ||
          !(countryCode === null ||
            (typeof countryCode === 'string' && /^[A-Z]{2}$/.test(countryCode)))) {
        throw new Error('Invalid offline place protocol');
      }
      ids.add(id);
      result.push({
        id, name, italianName, latMicro, lngMicro, population, stateId,
        region, timeZone, countryName, countryCode,
      });
    }
    return result;
  } catch {
    // Never expose unexpected accessor/proxy errors, local paths or IPC details.
    throw new Error('Invalid offline place protocol');
  }
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
    if (query.trim().length < 2 || [...query].length > 80) {
      return {kind: 'query_too_short', items: []};
    }
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
