/**
 * Strict civil-time to UTC resolution for a future VirgoStars Ephemeris request.
 * Uses the host's IANA time zone database. No astronomical calculations are made.
 * Ambiguous and nonexistent local times are never silently adjusted.
 */
export type CivilTimeInput = Readonly<{
  date: string; // Gregorian YYYY-MM-DD, inclusive years 0000..5000 (astronomical numbering: 0000 is 1 BC)
  time: string; // 24-hour HH:mm or HH:mm:ss; leap seconds are unsupported
  timeZone: string; // IANA zone, e.g. Europe/Rome (no numeric offset)
}>;

export type CivilTimeChoice = Readonly<{
  instantUtc: string; // ISO 8601 with trailing Z
  offsetSeconds: number; // east of UTC; historical offsets may have seconds
}>;

export type CivilTimeResult =
  | Readonly<{ status: 'resolved'; timeZone: string; choice: CivilTimeChoice }>
  | Readonly<{ status: 'ambiguous'; timeZone: string; choices: readonly CivilTimeChoice[] }>
  | Readonly<{ status: 'nonexistent'; timeZone: string }>
  | Readonly<{
      status: 'invalid';
      code: 'INVALID_LOCAL_DATE' | 'INVALID_LOCAL_TIME' | 'INVALID_TIME_ZONE' | 'TIME_ZONE_UNAVAILABLE';
    }>;

type WallParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
const HOUR_MS = 3_600_000;
const PROBE_HOURS = 48;
const MIN_YEAR = 0;
const MAX_YEAR = 5000;

/** UTC milliseconds of a calendar reading. Unlike Date.UTC, the years 0 to 99 stay the years 0 to 99. */
function utcOfParts(year: number, monthIndex: number, day: number, hour = 0, minute = 0, second = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}


function wallAt(formatter: Intl.DateTimeFormat, epochMs: number): WallParts {
  const values: Record<string, number> = {};
  let before = false;
  for (const { type, value } of formatter.formatToParts(new Date(epochMs))) {
    if (type === 'era') before = /^b/i.test(value);
    else if (type === 'year' || type === 'month' || type === 'day' ||
        type === 'hour' || type === 'minute' || type === 'second') {
      values[type] = Number(value);
    }
  }
  return {
    // Astronomical year: 1 BC is 0, 2 BC is -1.
    year: before ? 1 - values['year'] : values['year'], month: values['month'], day: values['day'],
    hour: values['hour'], minute: values['minute'], second: values['second'],
  };
}

function sameWall(a: WallParts, b: WallParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day &&
    a.hour === b.hour && a.minute === b.minute && a.second === b.second;
}

function utcOfWall(wall: WallParts): number {
  return utcOfParts(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

/**
 * Returns zero, one or all valid UTC instants for the requested wall time.
 * No implicit DST "earlier" or "later" preference. Caller must ask on ambiguity.
 * This function is CPU-bounded and does not access disk, network or account state.
 */
export function resolveCivilTime(input: CivilTimeInput): CivilTimeResult {
  const date = typeof input?.date === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.date) : null;
  if (!date) return { status: 'invalid', code: 'INVALID_LOCAL_DATE' };
  const year = Number(date[1]), month = Number(date[2]), day = Number(date[3]);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1 || day > 31) {
    return { status: 'invalid', code: 'INVALID_LOCAL_DATE' };
  }
  const time = typeof input.time === 'string' ? /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input.time) : null;
  if (!time) return { status: 'invalid', code: 'INVALID_LOCAL_TIME' };
  const hour = Number(time[1]), minute = Number(time[2]), second = Number(time[3] ?? '00');
  if (hour > 23 || minute > 59 || second > 59) return { status: 'invalid', code: 'INVALID_LOCAL_TIME' };
  const target: WallParts = { year, month, day, hour, minute, second };
  const naiveUtc = utcOfWall(target);
  const normalized = new Date(naiveUtc);
  if (!Number.isFinite(naiveUtc) || !sameWall(target, {
    year: normalized.getUTCFullYear(), month: normalized.getUTCMonth() + 1,
    day: normalized.getUTCDate(), hour: normalized.getUTCHours(),
    minute: normalized.getUTCMinutes(), second: normalized.getUTCSeconds(),
  })) return { status: 'invalid', code: 'INVALID_LOCAL_DATE' };

  if (typeof input.timeZone !== 'string' || input.timeZone.length > 120 ||
    !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(input.timeZone)) {
    return { status: 'invalid', code: 'INVALID_TIME_ZONE' };
  }

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-GB-u-ca-gregory-nu-latn', {
      timeZone: input.timeZone,
      era: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
  } catch (err) {
    if (err instanceof RangeError) return { status: 'invalid', code: 'INVALID_TIME_ZONE' };
    return { status: 'invalid', code: 'TIME_ZONE_UNAVAILABLE' };
  }

  try {
    const offsets = new Set<number>();
    // Probe both sides of all civil-time boundaries, including date-line jumps.
    // One-hour sampling retains sub-hour and historical second-based offsets.
    for (let h = -PROBE_HOURS; h <= PROBE_HOURS; h++) {
      const probe = naiveUtc + h * HOUR_MS;
      offsets.add((utcOfWall(wallAt(formatter, probe)) - probe) / 1000);
    }
    const candidates: CivilTimeChoice[] = [];
    for (const offsetSeconds of offsets) {
      if (!Number.isInteger(offsetSeconds) || Math.abs(offsetSeconds) > 172800) {
        return { status: 'invalid', code: 'TIME_ZONE_UNAVAILABLE' };
      }
      const epoch = naiveUtc - offsetSeconds * 1000;
      if (sameWall(wallAt(formatter, epoch), target)) {
        candidates.push({ instantUtc: new Date(epoch).toISOString(), offsetSeconds });
      }
    }
    candidates.sort((a, b) => a.instantUtc.localeCompare(b.instantUtc));
    const timeZone = formatter.resolvedOptions().timeZone;
    if (candidates.length === 0) return { status: 'nonexistent', timeZone };
    if (candidates.length === 1) return { status: 'resolved', timeZone, choice: candidates[0] };
    return { status: 'ambiguous', timeZone, choices: candidates };
  } catch {
    // Missing/broken host ICU must never produce a made-up UTC instant.
    return { status: 'invalid', code: 'TIME_ZONE_UNAVAILABLE' };
  }
}
