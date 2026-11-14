import type { Locale } from './translations';
import type { OfflinePlaceV1 } from './native/offline-places-contract';

/** Wall-clock time only. Never treat the device clock as an ephemeris or birth time. */
export interface ClockDriver {
  now(): number;
  schedule(callback: () => void): unknown;
  cancel(handle: unknown): void;
}

const SYSTEM_CLOCK: ClockDriver = {
  now: () => Date.now(),
  schedule: callback => setInterval(callback, 1000),
  cancel: handle => clearInterval(handle as ReturnType<typeof setInterval>),
};
const MAX_DATE_MS = 8_640_000_000_000_000;

/** A transient invalid/throwing device clock must never preserve an obsolete instant. */
function readClockTime(driver: ClockDriver): number {
  try {
    const value = driver.now();
    return Number.isFinite(value) && Math.abs(value) <= MAX_DATE_MS ? value : NaN;
  } catch {
    return NaN;
  }
}

export class DeviceClock {
  timestamp: number;
  private timer: unknown | null = null;
  private starting = false;
  private disposed = false;
  // Reject late callbacks from a stopped interval, even after restarting.
  private generation = 0;
  private readonly driver: ClockDriver;

  constructor(driver: ClockDriver = SYSTEM_CLOCK) {
    this.driver = driver;
    this.timestamp = readClockTime(driver);
  }

  /** Tick from actual wall time, not elapsed intervals, to survive OS sleep. */
  start(changed: () => void): void {
    if (this.disposed || this.timer !== null || this.starting) return;
    // refresh() and schedule() may invoke callbacks synchronously. Treat start
    // as in progress until the first handle has been installed or abandoned.
    this.starting = true;
    const generation = this.generation;
    try {
      this.refresh(changed);
      if (this.disposed || generation !== this.generation) return;
      let handle: unknown;
      try {
        handle = this.driver.schedule(() => {
          if (generation === this.generation) this.refresh(changed);
        });
      } catch {
        // The injected scheduler may have paused/disposed the clock before
        // throwing. A stale start must not invalidate its hidden snapshot.
        if (generation === this.generation) this.invalidateTime(changed);
        return;
      }
      if (handle === null || handle === undefined) {
        if (generation === this.generation) this.invalidateTime(changed);
        return;
      }
      // A scheduler or observer may synchronously pause/destroy the clock.
      if (this.disposed || generation !== this.generation) {
        try { this.driver.cancel(handle); } catch { /* Already disposed; do not leak driver errors. */ }
        return;
      }
      this.timer = handle;
    } finally {
      this.starting = false;
    }
  }

  /** A clock without a working scheduler cannot safely display live time. */
  private invalidateTime(changed: () => void): void {
    if (this.disposed || Number.isNaN(this.timestamp)) return;
    this.timestamp = NaN;
    changed();
  }

  refresh(changed: () => void): void {
    if (this.disposed) return;
    const next = readClockTime(this.driver);
    const alreadyUnavailable = Number.isNaN(next) && Number.isNaN(this.timestamp);
    const sameSecond = Number.isFinite(next) && Number.isFinite(this.timestamp) &&
      Math.floor(next / 1000) === Math.floor(this.timestamp / 1000);
    if (alreadyUnavailable || sameSecond) return;
    this.timestamp = next;
    changed();
  }

  /** Suspend the ticking clock while the window is hidden; start() resumes it. */
  pause(): void {
    if (this.disposed) return;
    this.generation++;
    const handle = this.timer;
    this.timer = null;
    if (handle !== null) {
      try { this.driver.cancel(handle); } catch { /* A stopped timer must never block the UI. */ }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    const handle = this.timer;
    this.timer = null;
    if (handle !== null) {
      try { this.driver.cancel(handle); } catch { /* Never block UI teardown. */ }
    }
  }
}

/** Format device wall time with its own timezone, or an explicit test timezone. */
export function formatDeviceClock(timestamp: number, locale: Locale, compact = false, timeZone?: string): string {
  if (!Number.isFinite(timestamp) || Math.abs(timestamp) > MAX_DATE_MS) return '—';
  try {
    const options: Intl.DateTimeFormatOptions = {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      timeZoneName: 'short',
      ...(compact ? {} : {year: 'numeric' as const, month: 'short' as const, day: '2-digit' as const}),
      ...(timeZone ? {timeZone} : {}),
    };
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'it-IT', options)
      .format(new Date(timestamp));
  } catch { return '—'; }
}

/**
 * The Angular template reads both clock variants on every change-detection pass.
 * Reuse strings for one timestamp/locale without caching Intl formatters across
 * system timezone changes. Exactly two values are retained, never user records.
 */
export class DeviceClockTextCache {
  private timestamp = NaN;
  private locale: Locale | null = null;
  private full: string | null = null;
  private compact: string | null = null;
  private readonly format: (ms: number, locale: Locale, compact: boolean) => string;

  constructor(format: (ms: number, locale: Locale, compact: boolean) => string = formatDeviceClock) {
    this.format = format;
  }

  text(ms: number, locale: Locale, compact = false): string {
    if (!Object.is(ms, this.timestamp) || locale !== this.locale) {
      this.timestamp = ms;
      this.locale = locale;
      this.full = null;
      this.compact = null;
    }
    if (compact) {
      return this.compact ?? (this.compact = this.format(ms, locale, true));
    }
    return this.full ?? (this.full = this.format(ms, locale, false));
  }
}

/** Only a civil-time preview; a selected city never changes synthetic chart data. */
export type SelectedCityClock =
  | Readonly<{kind: 'not_selected'}>
  | Readonly<{kind: 'unavailable'}>
  | Readonly<{kind: 'ready'; text: string; timeZone: string}>;

/** Fail closed on absent/invalid tzdb IDs; NEVER use the device timezone as fallback. */
export function selectedCityClockAt(
  timestamp: number,
  city: Pick<OfflinePlaceV1, 'timeZone'> | null,
  locale: Locale,
): SelectedCityClock {
  if (city === null) return {kind: 'not_selected'};
  // A malformed or revoked city object must not crash Angular's clock view.
  // Capture the timezone once; accessors may throw or change between reads.
  let zone: unknown;
  try {
    if (typeof city !== 'object' || Array.isArray(city)) return {kind: 'unavailable'};
    zone = city.timeZone;
  } catch {
    return {kind: 'unavailable'};
  }
  if (typeof zone !== 'string' || zone.length === 0 || zone.length > 80 ||
      !/^[A-Za-z0-9_+\/-]+$/.test(zone)) return {kind: 'unavailable'};
  const text = formatDeviceClock(timestamp, locale, false, zone);
  if (text === '—') return {kind: 'unavailable'};
  return {kind: 'ready', text, timeZone: zone};
}
