import {offlinePlaceQueryProblem} from './native/offline-city-query.js';
import type {OfflinePlaceV1, PlaceQueryState} from './native/offline-places-contract';

export type CityPickerStatus =
  | 'idle' | 'query_too_short' | 'query_too_long' | 'typing' | 'loading' | 'ready' | 'empty' | 'selected'
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
    // Retain one over-limit Unicode scalar without splitting surrogate pairs.
    // Oversized pasted text cannot turn into a seemingly valid prefix search.
    const chars: string[] = [];
    for (const char of value) {
      chars.push(char);
      if (chars.length > 80) break;
    }
    this.query = chars.join('');
    this.selected = null;
    this.results = [];
    this.activeIndex = -1;
    const length = [...this.query.trim()].filter(c => /[\p{L}\p{N}]/u.test(c)).length;
    const problem = offlinePlaceQueryProblem(this.query);
    if (length === 0 && problem !== 'query_too_long') this.status = 'idle';
    else if (problem) this.status = problem;
    else {
      this.status = 'typing';
      const ticket = this.seq;
      // A faulty WebView timer may throw, return no handle or invoke synchronously.
      // Never leave the UI in "typing" with no cancellable debounce.
      let fired = false;
      try {
        const handle = this.timers.set(() => {
          if (fired) return; // A broken driver cannot launch a duplicate lookup.
          fired = true;
          if (ticket !== this.seq || this.disposed) return;
          this.pending = null;
          void this.perform(ticket, this.query);
        }, this.debounceMs);
        if (handle === null || handle === undefined) {
          if (!fired) this.invalidateDebounce(ticket);
        } else if (fired || ticket !== this.seq || this.disposed) {
          // Callback already ran or owner changed while set() was in progress.
          try { this.timers.clear(handle); } catch { /* callback generation is guarded */ }
        } else {
          this.pending = handle; // Numeric zero is a valid timer handle.
        }
      } catch {
        if (!fired) this.invalidateDebounce(ticket);
      }
    }
    this.changed();
  }

  private async perform(ticket: number, query: string): Promise<void> {
    this.status = 'loading';
    this.changed();
    // A synchronous view notification may re-enter input() or dispose this
    // picker. Do not launch the superseded native query after that callback.
    if (ticket !== this.seq || this.disposed) return;
    try {
      const result = await this.lookup.search(query, 12);
      if (ticket !== this.seq || this.disposed) return;
      if (result.kind === 'ready') {
        this.results = result.items;
        this.status = result.items.length ? 'ready' : 'empty';
      } else if (result.kind !== 'stale') {
        this.results = [];
        this.status = result.kind;
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortPending();
    this.results = [];
    this.activeIndex = -1;
  }

  private invalidateDebounce(ticket: number): void {
    if (ticket !== this.seq || this.disposed) return;
    this.seq++;
    this.pending = null;
    this.status = 'unavailable';
    try { this.lookup.clear(); } catch { /* stale lookups are generation guarded */ }
  }

  private abortPending(): void {
    this.seq++;
    const handle = this.pending;
    this.pending = null;
    if (handle !== null) {
      try { this.timers.clear(handle); } catch { /* stale callbacks check seq */ }
    }
    try { this.lookup.clear(); } catch { /* never block local UI teardown/input */ }
  }
}
