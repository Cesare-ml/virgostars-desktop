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
    try {
      this.refresh(changed);
      if (this.disposed) return;
      let handle: unknown;
      try {
        handle = this.driver.schedule(() => this.refresh(changed));
      } catch {
        this.invalidateTime(changed);
        return;
      }
      if (handle === null || handle === undefined) {
        this.invalidateTime(changed);
        return;
      }
      // An injected scheduler may synchronously destroy the owner before returning.
      if (this.disposed) {
        try { this.driver.cancel(handle); } catch { /* Already disposed; do not leak driver errors. */ }
        return;
      }
      this.timer = handle;
    } finally {
      this.starting = false;
    }
  }

  /** Never let errors in the UI observer interrupt the live clock. */
  private emitChanged(changed: () => void): void {
    try { changed(); } catch { /* Keep observer errors private; continue sampling. */ }
  }

  /** A clock without a working scheduler cannot safely display live time. */
  private invalidateTime(changed: () => void): void {
    if (this.disposed || Number.isNaN(this.timestamp)) return;
    this.timestamp = NaN;
    this.emitChanged(changed);
  }

  refresh(changed: () => void): void {
    if (this.disposed) return;
    const next = readClockTime(this.driver);
    const alreadyUnavailable = Number.isNaN(next) && Number.isNaN(this.timestamp);
    const sameSecond = Number.isFinite(next) && Number.isFinite(this.timestamp) &&
      Math.floor(next / 1000) === Math.floor(this.timestamp / 1000);
    if (alreadyUnavailable || sameSecond) return;
    this.timestamp = next;
    this.emitChanged(changed);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
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
