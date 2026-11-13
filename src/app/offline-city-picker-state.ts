import type {OfflinePlaceV1, PlaceQueryState} from './native/offline-places-contract';

export type CityPickerStatus =
  | 'idle' | 'query_too_short' | 'typing' | 'loading' | 'ready' | 'empty' | 'selected'
  | 'not_native' | 'busy' | 'catalog_unavailable' | 'unavailable';

export interface CityLookupPort {
  search(query: string, limit?: number): Promise<PlaceQueryState>;
  clear(): void;
}
export interface CityPickerTimers {
  set(callback: () => void, delayMs: number): unknown;
  clear(id: unknown): void;
}
const realTimers: CityPickerTimers = {
  set: (callback, delay) => setTimeout(callback, delay),
  clear: id => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** One debounce timer and one latest result array; never cache the city database in Angular. */
export class OfflineCityPickerState {
  query = '';
  status: CityPickerStatus = 'idle';
  results: readonly OfflinePlaceV1[] = [];
  selected: OfflinePlaceV1 | null = null;
  activeIndex = -1;
  private pending: unknown | null = null;
  private seq = 0;
  private disposed = false;
  private readonly lookup: CityLookupPort;
  private readonly changed: () => void;
  private readonly timers: CityPickerTimers;
  private readonly debounceMs: number;

  constructor(lookup: CityLookupPort, changed: () => void = () => {},
    timers: CityPickerTimers = realTimers, debounceMs = 180) {
    this.lookup = lookup; this.changed = changed;
    this.timers = timers; this.debounceMs = debounceMs;
  }

  input(value: string): void {
    if (this.disposed) return;
    this.abortPending();
    // Match the native query limit in Unicode scalar values, not UTF-16 units.
    this.query = [...value].slice(0, 80).join('');
    this.selected = null;
    this.results = [];
    this.activeIndex = -1;
    const length = [...this.query.trim()].filter(c => /[\p{L}\p{N}]/u.test(c)).length;
    if (length === 0) this.status = 'idle';
    else if (length < 2) this.status = 'query_too_short';
    else {
      this.status = 'typing';
      const ticket = this.seq;
      this.pending = this.timers.set(() => {
        this.pending = null;
        if (ticket === this.seq && !this.disposed) void this.perform(ticket, this.query);
      }, this.debounceMs);
    }
    this.changed();
  }

  private async perform(ticket: number, query: string): Promise<void> {
    this.status = 'loading';
    this.changed();
    try {
      const result = await this.lookup.search(query, 12);
      if (ticket !== this.seq || this.disposed) return;
      if (result.kind === 'ready') {
        this.results = result.items;
        this.status = result.items.length ? 'ready' : 'empty';
      } else {
        this.results = [];
        // Even a current query may be invalidated by its native lookup scope.
        // Always settle loading into an explicit retryable state.
        this.status = result.kind === 'stale' ? 'busy' : result.kind;
      }
    } catch {
      if (ticket !== this.seq || this.disposed) return;
      this.results = [];
      this.status = 'unavailable';
    }
    if (ticket === this.seq && !this.disposed) this.changed();
  }

  move(delta: -1 | 1): void {
    if (this.disposed || !this.results.length) return;
    this.activeIndex = this.activeIndex < 0
      ? (delta === 1 ? 0 : this.results.length - 1)
      : (this.activeIndex + delta + this.results.length) % this.results.length;
    this.changed();
  }

  choose(index: number): OfflinePlaceV1 | null {
    if (this.disposed || !Number.isInteger(index) || index < 0 || index >= this.results.length) return null;
    const chosen = this.results[index];
    this.abortPending();
    this.selected = chosen;
    this.query = chosen.name;
    this.status = 'selected';
    this.results = [];
    this.activeIndex = -1;
    this.changed();
    return chosen;
  }

  chooseActive(): OfflinePlaceV1 | null { return this.choose(this.activeIndex); }

  dismiss(): void {
    if (this.disposed) return;
    this.abortPending();
    this.results = [];
    this.activeIndex = -1;
    if (this.status !== 'selected') this.status = 'idle';
    this.changed();
  }

  restore(place: OfflinePlaceV1): void {
    if (this.disposed) return;
    this.abortPending();
    this.selected = place;
    this.query = place.name;
    this.results = [];
    this.activeIndex = -1;
    this.status = 'selected';
    this.changed();
  }

  /** Explicitly forget the temporary city; no persistence or network operation. */
  clearSelection(): void {
    if (this.disposed) return;
    this.abortPending();
    this.selected = null;
    this.query = '';
    this.results = [];
    this.activeIndex = -1;
    this.status = 'idle';
    this.changed();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortPending();
    this.results = [];
    this.activeIndex = -1;
  }

  private abortPending(): void {
    this.seq++;
    if (this.pending !== null) this.timers.clear(this.pending);
    this.pending = null;
    this.lookup.clear();
  }
}
