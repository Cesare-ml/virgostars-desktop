/**
 * Time arithmetic for "Naviga cielo": moving a chart's instant forwards and backwards by the
 * field arrows or by a chosen step. Pure functions, no astronomy and no state.
 *
 * Hours and minutes move the instant by elapsed time. Days, months and years move the local
 * calendar date of the chart's own time zone and keep its local clock time, so a day step across a
 * daylight-saving change still lands on the same wall-clock hour. The date
 * navigator is bounded by the supported automatic historical time model.
 */
import type {HistoricalChartRequest} from './native/historical-chart-contract';
export type StepUnit = 'min' | 'h' | 'd';
export type NavField = 'day' | 'month' | 'year' | 'hour' | 'minute';

export type StepRow = Readonly<{unit: StepUnit; values: readonly number[]}>;
/** The steps offered: minutes, hours and days. */
export const STEP_ROWS: readonly StepRow[] = Object.freeze([
  Object.freeze({unit: 'min', values: Object.freeze([1, 3, 4, 6, 10, 20])}),
  Object.freeze({unit: 'h', values: Object.freeze([1, 4, 6, 7, 12])}),
  Object.freeze({unit: 'd', values: Object.freeze([1, 7, 15, 30])}),
] as const);
export const DEFAULT_STEP = Object.freeze({unit: 'min' as StepUnit, value: 4 as number});

export const MIN_YEAR = 1;
export const MAX_YEAR = 3000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export type LocalParts = Readonly<{year: number; month: number; day: number; hour: number; minute: number; second: number}>;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat | null {
  const known = formatters.get(timeZone);
  if (known) return known;
  try {
    // The era is asked for because year 0 is written "1 BC" and years before it count down.
    const created = new Intl.DateTimeFormat('en-GB', {
      timeZone, hourCycle: 'h23', era: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(timeZone, created);
    return created;
  } catch {
    return null;
  }
}

/** The wall-clock reading of an instant in a time zone, or null for an unknown zone or instant. */
export function localParts(utcMs: number, timeZone: string): LocalParts | null {
  const format = formatter(timeZone);
  if (!format || !Number.isFinite(utcMs) || Math.abs(utcMs) > 8_640_000_000_000_000) return null;
  const values: Record<string, number> = {};
  let before = false;
  for (const {type, value} of format.formatToParts(new Date(utcMs))) {
    if (type === 'era') before = /^b/i.test(value);
    else if (type !== 'literal') values[type] = Number(value);
  }
  const parts = {
    // Astronomical year: 1 BC is 0, 2 BC is -1.
    year: before ? 1 - values['year'] : values['year'], month: values['month'], day: values['day'],
    hour: values['hour'] === 24 ? 0 : values['hour'], minute: values['minute'], second: values['second'],
  };
  return Object.values(parts).every(Number.isFinite) ? parts : null;
}

/** UTC milliseconds of a calendar reading. Unlike Date.UTC, the years 0 to 99 stay the years 0 to 99. */
function utcOfParts(year: number, monthIndex: number, day: number, hour = 0, minute = 0, second = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

const pad = (value: number, length = 2): string => String(value).padStart(length, '0');

const DAY_MS = 86_400_000;
const sameWall = (a: LocalParts, b: LocalParts): boolean =>
  a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute && a.second === b.second;

/** Offset of the zone from UTC at an instant, in ms (east positive). */
function offsetAt(utcMs: number, timeZone: string): number | null {
  const parts = localParts(utcMs, timeZone);
  return parts ? utcOfParts(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(utcMs / 1000) * 1000 : null;
}

/** Use the city's available zone rules; historical offsets may be extrapolated. */
export function historicalNavigationRequest(utcMs:number, timeZone:string, latMicro:number, lngMicro:number):HistoricalChartRequest | null {
  const civil = localParts(utcMs, timeZone);
  const offset = offsetAt(utcMs, timeZone);
  if (!civil || offset === null || civil.year < MIN_YEAR || civil.year > MAX_YEAR) return null;
  return {civil:{...civil, calendar:'gregorian', offset:{kind:'supplied', secondsEast:offset / 1000,
      source:`IANA ${timeZone} (historical rules may be extrapolated)`}, uncertaintySeconds:0},
    deltaT:{kind:'espenakMeeus2006Unquantified'}, latMicro, lngMicro};
}

/** Every instant at which the zone's clock reads `parts`: none, one, or two when the clock goes back. */
function instantsOfWall(parts: LocalParts, timeZone: string): number[] {
  const naive = utcOfParts(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  // The offsets in force a day before and a day after bracket any single clock change.
  const offsets = new Set<number>();
  for (const probe of [naive - DAY_MS, naive + DAY_MS]) {
    const offset = offsetAt(probe, timeZone);
    if (offset !== null) offsets.add(offset);
  }
  const found = new Set<number>();
  for (const offset of offsets) {
    const candidate = naive - offset;
    const reading = localParts(candidate, timeZone);
    if (reading && sameWall(reading, parts)) found.add(candidate);
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * The instant of a wall-clock reading. An ambiguous reading (the clock goes back) takes the earlier
 * instant; a reading that does not exist (the clock jumps forward) takes the same minute one hour
 * later, which is the reading the clock shows after the jump.
 */
export function utcFromLocal(parts: LocalParts, timeZone: string): number | null {
  if (!formatter(timeZone)) return null;
  const direct = instantsOfWall(parts, timeZone);
  if (direct.length) return direct[0];
  // Nonexistent local time: one hour on.
  if (parts.hour >= 23) return null;
  const later = instantsOfWall({...parts, hour: parts.hour + 1}, timeZone);
  return later.length ? later[0] : null;
}

function inRange(utcMs: number | null, timeZone: string): number | null {
  if (utcMs === null || !Number.isFinite(utcMs)) return null;
  const parts = localParts(utcMs, timeZone);
  return parts && parts.year >= MIN_YEAR && parts.year <= MAX_YEAR ? utcMs : null;
}

/** Replace one displayed field, rejecting invalid calendar dates and clock readings. */
export function setInstantField(utcMs:number, timeZone:string, field:NavField, text:string):number | null {
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  const local = localParts(utcMs, timeZone);
  if (!local || !Number.isSafeInteger(value)) return null;
  const next = {...local, [field]:value};
  if (next.year < MIN_YEAR || next.year > MAX_YEAR || next.month < 1 || next.month > 12 ||
      next.hour < 0 || next.hour > 23 || next.minute < 0 || next.minute > 59) return null;
  const days = new Date(utcOfParts(next.year, next.month, 0)).getUTCDate();
  if (next.day < 1 || next.day > days) return null;
  const instant = utcFromLocal(next, timeZone);
  const resolved = instant === null ? null : localParts(instant, timeZone);
  // A manually typed nonexistent wall time must not silently become another hour.
  return resolved && sameWall(resolved, next) ? inRange(instant, timeZone) : null;
}

/** Moves one field of the chart's local date and time by one unit (or several). */
export function shiftInstant(utcMs: number, timeZone: string, field: NavField, delta: number): number | null {
  if (!Number.isInteger(delta)) return null;
  if (field === 'minute') return inRange(utcMs + delta * MINUTE_MS, timeZone);
  if (field === 'hour') return inRange(utcMs + delta * HOUR_MS, timeZone);
  const local = localParts(utcMs, timeZone);
  if (!local) return null;
  let year = local.year, month = local.month, day = local.day;
  if (field === 'day') {
    const moved = new Date(utcOfParts(year, month - 1, day + delta));
    year = moved.getUTCFullYear(); month = moved.getUTCMonth() + 1; day = moved.getUTCDate();
  } else {
    // Months and years keep the day number, or the last day of a shorter month.
    const months = field === 'month' ? delta : delta * 12;
    const first = new Date(utcOfParts(year, month - 1 + months, 1));
    year = first.getUTCFullYear(); month = first.getUTCMonth() + 1;
    day = Math.min(day, new Date(utcOfParts(year, month, 0)).getUTCDate());
  }
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  return inRange(utcFromLocal({...local, year, month, day}, timeZone), timeZone);
}

/** One step of the chosen size, forwards (+1) or backwards (-1). */
export function stepInstant(utcMs: number, timeZone: string, unit: StepUnit, value: number, direction: 1 | -1): number | null {
  if (!Number.isInteger(value) || value < 1) return null;
  if (unit === 'min') return shiftInstant(utcMs, timeZone, 'minute', direction * value);
  if (unit === 'h') return shiftInstant(utcMs, timeZone, 'hour', direction * value);
  return shiftInstant(utcMs, timeZone, 'day', direction * value);
}

/** The two-digit text of each field (the year has four digits), for the clock of the panel. */
export function fieldTexts(utcMs: number, timeZone: string): Record<NavField, string> | null {
  const parts = localParts(utcMs, timeZone);
  if (!parts) return null;
  return {
    day: pad(parts.day), month: pad(parts.month), year: pad(parts.year, 4),
    hour: pad(parts.hour), minute: pad(parts.minute),
  };
}

/** "Elettiva 2026-11-17 16:11:44": the label and the local date and time of the chart. */
export function defaultElectiveName(label: string, utcMs: number, timeZone: string): string {
  const parts = localParts(utcMs, timeZone);
  if (!parts) return label;
  return `${label} ${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

/** The ISO instant the native commands expect (whole milliseconds, trailing Z). */
export function isoFromMs(utcMs: number): string {
  return new Date(utcMs).toISOString();
}
