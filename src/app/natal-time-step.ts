/** Gregorian days via UTC calendar; independent of the natal draft and host timezone. */
function gregorianDaysInMonth(year:number, month:number): number {
  const d=new Date(0);
  d.setUTCFullYear(year,month,0);
  d.setUTCHours(0,0,0,0);
  return d.getUTCDate();
}

export type CorrectionField = 'year' | 'month' | 'day' | 'hour' | 'minute';
export type CorrectionDirection = -1 | 1;

/** Human-entered *civil wall time*, not UTC and never adjusted using current DST. */
export interface CivilCorrectionInput {
  readonly year: string;
  readonly month: string;
  readonly day: string;
  readonly hour: string;
  readonly minute: string;
  readonly birthTimeKnown: boolean;
}
export interface CivilCorrectionOutput {
  readonly year: string;
  readonly month: string;
  readonly day: string;
  readonly hour: string;
  readonly minute: string;
}

function parseNumber(input: string, min: number, max: number): number | null {
  if (!/^\d{1,4}$/.test(input)) return null;
  const number = Number(input);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}
function civilUtcDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  // Avoid JS Date.UTC(year=0..99) interpreting the year as 1900..1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, 0, 0);
  return date;
}
function stringify(year: number, month: number, day: number, hour: number, minute: number): CivilCorrectionOutput {
  return {
    year: String(year), month: String(month), day: String(day),
    hour: String(hour).padStart(2, '0'), minute: String(minute).padStart(2, '0')
  };
}
function preserveUnknownTime(input: CivilCorrectionInput, next: CivilCorrectionOutput): CivilCorrectionOutput {
  // Date-only corrections must not invent a time that was never provided.
  return input.birthTimeKnown ? next : {...next, hour: input.hour, minute: input.minute};
}

/**
 * Advance exactly one wall-clock/calendar unit. A day/minute step can roll over
 * date boundaries; month/year steps clamp impossible day-of-month.
 * Returns null for incomplete/invalid input, unknown birth time when changing
 * hour/minute, or Gregorian year 1/9999 overflow. No fabricated defaults.
 *
 * NOTE: this is an editor operation, not a timezone or astronomical calculation.
 * Preview DST gap/fold candidates MUST be invalidated by the caller.
 */
export function stepCivilCorrection(
  input: CivilCorrectionInput,
  field: CorrectionField,
  direction: CorrectionDirection
): CivilCorrectionOutput | null {
  if (direction !== -1 && direction !== 1) return null;
  const year = parseNumber(input.year, 1, 9999);
  const month = parseNumber(input.month, 1, 12);
  const day = parseNumber(input.day, 1, 31);
  if (year === null || month === null || day === null || day > gregorianDaysInMonth(year, month)) return null;

  const hour = input.birthTimeKnown ? parseNumber(input.hour, 0, 23) : 0;
  const minute = input.birthTimeKnown ? parseNumber(input.minute, 0, 59) : 0;
  if (input.birthTimeKnown && (hour === null || minute === null)) return null;
  if (!input.birthTimeKnown && (field === 'hour' || field === 'minute')) return null;
  if (hour === null || minute === null) return null;

  if (field === 'year') {
    const next = year + direction;
    return next >= 1 && next <= 9999
      ? preserveUnknownTime(input, stringify(next, month, Math.min(day, gregorianDaysInMonth(next, month)), hour, minute))
      : null;
  }
  if (field === 'month') {
    const absolute = year * 12 + month - 1 + direction;
    const nextYear = Math.floor(absolute / 12);
    const nextMonth = absolute - nextYear * 12 + 1;
    return nextYear >= 1 && nextYear <= 9999
      ? preserveUnknownTime(input, stringify(nextYear, nextMonth, Math.min(day, gregorianDaysInMonth(nextYear, nextMonth)), hour, minute))
      : null;
  }
  if (field !== 'day' && field !== 'hour' && field !== 'minute') return null;

  const date = civilUtcDate(year, month, day, hour, minute);
  if (field === 'day') date.setUTCDate(date.getUTCDate() + direction);
  if (field === 'hour') date.setUTCHours(date.getUTCHours() + direction);
  if (field === 'minute') date.setUTCMinutes(date.getUTCMinutes() + direction);
  const nextYear = date.getUTCFullYear();
  if (nextYear < 1 || nextYear > 9999 || !Number.isFinite(date.getTime())) return null;
  return preserveUnknownTime(input, stringify(nextYear, date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()));
}

/** A single scheduled repeat at a time, with deterministic cancellation. */
export interface CorrectionTimer {
  set(callback: () => void, milliseconds: number): unknown;
  clear(handle: unknown): void;
}
const defaultTimer: CorrectionTimer = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
};
export class CorrectionHold {
  private handle: unknown | null = null;
  private generation = 0;
  private active = false;
  private repeats = 0;
  private disposed = false;
  private readonly timer: CorrectionTimer;

  constructor(timer: CorrectionTimer = defaultTimer) { this.timer = timer; }
  /** A callback returning false stops repeating at invalid input/boundary. */
  start(step: () => boolean): void {
    if (this.disposed) return;
    this.stop();
    const token = this.generation;
    this.active = step();
    if (!this.active) return;
    this.repeats = 0;
    const tick = () => {
      this.handle = null;
      if (this.disposed || !this.active || token !== this.generation) return;
      if (!step()) { this.stop(); return; }
      this.repeats++;
      // Initial 340 ms hold, then 75 ms / 45 ms, max ~22 local edits/s.
      this.handle = this.timer.set(tick, this.repeats >= 18 ? 45 : 75);
    };
    this.handle = this.timer.set(tick, 340);
  }
  stop(): void {
    this.generation++;
    this.active = false;
    if (this.handle !== null) this.timer.clear(this.handle);
    this.handle = null;
  }
  dispose(): void { this.stop(); this.disposed = true; }
  get running(): boolean { return this.active; }
}
