import type { Locale } from './translations';

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

export class DeviceClock {
  timestamp: number;
  private timer: unknown | null = null;
  private disposed = false;
  private readonly driver: ClockDriver;

  constructor(driver: ClockDriver = SYSTEM_CLOCK) {
    this.driver = driver;
    const initial = driver.now();
    this.timestamp = Number.isFinite(initial) && Math.abs(initial) <= MAX_DATE_MS ? initial : 0;
  }

  /** Tick from actual wall time, not elapsed intervals, to survive OS sleep. */
  start(changed: () => void): void {
    if (this.disposed || this.timer !== null) return;
    this.refresh(changed);
    this.timer = this.driver.schedule(() => this.refresh(changed));
  }

  refresh(changed: () => void): void {
    if (this.disposed) return;
    const next = this.driver.now();
    if (!Number.isFinite(next) || Math.abs(next) > MAX_DATE_MS ||
        Math.floor(next / 1000) === Math.floor(this.timestamp / 1000)) return;
    this.timestamp = next;
    changed();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== null) this.driver.cancel(this.timer);
    this.timer = null;
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
