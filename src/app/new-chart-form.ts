/**
 * Pure validation for the "new chart" form. No astronomy and no storage:
 * it turns what was typed into one UTC instant and one position, or says
 * exactly which field stops it. The civil-time resolver is injected.
 */
import type {CivilTimeChoice, CivilTimeInput, CivilTimeResult} from './native/civil-time';

export type NewChartFields = Readonly<{
  name: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm or HH:mm:ss
  timeZone: string; // IANA
  latitude: string; // decimal degrees, north positive
  longitude: string; // decimal degrees, east positive
  placeName: string;
}>;

export type NewChartInput = Readonly<{
  name: string;
  utcIso: string;
  localDate: string;
  localTime: string;
  timeZone: string;
  offsetSeconds: number;
  latMicro: number;
  lngMicro: number;
  placeName: string;
}>;

export type NewChartProblem =
  | 'date_invalid' | 'time_invalid' | 'zone_invalid' | 'zone_unavailable'
  | 'latitude_invalid' | 'longitude_invalid' | 'time_nonexistent' | 'instant_unavailable';

export type NewChartResolution =
  | Readonly<{status: 'ready'; input: NewChartInput}>
  | Readonly<{status: 'choice_required'; choices: readonly CivilTimeChoice[]}>
  | Readonly<{status: 'problem'; problem: NewChartProblem}>;

export const MAX_CHART_NAME_LENGTH = 80;

/** Strip control characters and trim; the name is display-only text. */
export function cleanChartName(raw: string): string {
  return [...String(raw ?? '')].filter(ch => ch >= ' ' && ch !== '\u007f').join('')
    .trim().slice(0, MAX_CHART_NAME_LENGTH);
}

/** Decimal degrees with `.` or `,`; returns micro-degrees or null. */
export function parseDegreesMicro(raw: string, limit: 90 | 180): number | null {
  const text = String(raw ?? '').trim().replace(',', '.');
  if (!/^[+-]?\d{1,3}(?:\.\d{1,8})?$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || Math.abs(value) > limit) return null;
  return Math.round(value * 1e6);
}

const CIVIL_PROBLEMS: Record<string, NewChartProblem> = {
  INVALID_LOCAL_DATE: 'date_invalid',
  INVALID_LOCAL_TIME: 'time_invalid',
  INVALID_TIME_ZONE: 'zone_invalid',
  TIME_ZONE_UNAVAILABLE: 'zone_unavailable',
};

/**
 * `selectedUtc` is the user's answer to a daylight-saving fold. It must be one
 * of the instants the resolver returns for the fields as they are now.
 */
export function resolveNewChart(
  fields: NewChartFields,
  resolveCivil: (input: CivilTimeInput) => CivilTimeResult,
  selectedUtc: string | null = null,
): NewChartResolution {
  const latMicro = parseDegreesMicro(fields.latitude, 90);
  if (latMicro === null) return {status: 'problem', problem: 'latitude_invalid'};
  const lngMicro = parseDegreesMicro(fields.longitude, 180);
  if (lngMicro === null) return {status: 'problem', problem: 'longitude_invalid'};

  let civil: CivilTimeResult;
  try {
    civil = resolveCivil({date: fields.date, time: fields.time, timeZone: fields.timeZone.trim()});
  } catch {
    return {status: 'problem', problem: 'zone_unavailable'};
  }
  if (civil.status === 'invalid') return {status: 'problem', problem: CIVIL_PROBLEMS[civil.code] ?? 'zone_unavailable'};
  if (civil.status === 'nonexistent') return {status: 'problem', problem: 'time_nonexistent'};

  let choice: CivilTimeChoice | undefined;
  if (civil.status === 'resolved') choice = civil.choice;
  else {
    choice = civil.choices.find(option => option.instantUtc === selectedUtc);
    if (!choice) return {status: 'choice_required', choices: civil.choices};
  }
  return {
    status: 'ready',
    input: {
      name: cleanChartName(fields.name),
      utcIso: choice.instantUtc,
      localDate: fields.date,
      localTime: fields.time,
      timeZone: civil.timeZone,
      offsetSeconds: choice.offsetSeconds,
      latMicro, lngMicro,
      placeName: cleanChartName(fields.placeName),
    },
  };
}

/** `+01:00` style label for an offset east of UTC. */
export function formatUtcOffset(offsetSeconds: number): string {
  const sign = offsetSeconds < 0 ? '-' : '+';
  const total = Math.abs(Math.trunc(offsetSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return sign + pad(hours) + ':' + pad(minutes) + (seconds ? ':' + pad(seconds) : '');
}


export type NewChartNowResolution =
  | Readonly<{status: 'ready'; input: NewChartInput}>
  | Readonly<{status: 'problem'; problem: NewChartProblem}>;

/**
 * Build a chart request for the current instant at the entered place.
 * Unlike a birth-time form, it does not resolve local civil time: the current
 * UTC instant is unambiguous. Coordinates and the display timezone must still
 * be valid; an empty timezone is never silently replaced with UTC.
 *
 * The Date is injectable so tests can assert the exact instant without
 * depending on the machine clock.
 */
export function resolveNowChart(
  fields: Pick<NewChartFields, 'name' | 'timeZone' | 'latitude' | 'longitude' | 'placeName'>,
  now: Date = new Date(),
): NewChartNowResolution {
  const latMicro = parseDegreesMicro(fields.latitude, 90);
  if (latMicro === null) return {status: 'problem', problem: 'latitude_invalid'};
  const lngMicro = parseDegreesMicro(fields.longitude, 180);
  if (lngMicro === null) return {status: 'problem', problem: 'longitude_invalid'};

  const milliseconds = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(milliseconds) || Math.abs(milliseconds) > 8_640_000_000_000_000) {
    return {status: 'problem', problem: 'instant_unavailable'};
  }

  const timeZone = typeof fields.timeZone === 'string' ? fields.timeZone.trim() : '';
  if (!timeZone || timeZone.length > 120) {
    return {status: 'problem', problem: 'zone_invalid'};
  }
  let utcIso: string;
  let localParts: Intl.DateTimeFormatPart[];
  try {
    // Keep the captured UTC instant authoritative and derive civil metadata
    // from that same instant; never round-trip through an ambiguous local time.
    utcIso = new Date(milliseconds).toISOString();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(utcIso)) {
      return {status: 'problem', problem: 'instant_unavailable'};
    }
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    localParts = formatter.formatToParts(new Date(milliseconds));
  } catch {
    return {status: 'problem', problem: 'zone_invalid'};
  }

  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    localParts.find(item => item.type === type)?.value ?? '';
  const year = Number(part('year'));
  const month = Number(part('month'));
  const day = Number(part('day'));
  const hour = Number(part('hour'));
  const minute = Number(part('minute'));
  const second = Number(part('second'));
  if (!Number.isInteger(year) || year < 1 || year > 9999 ||
      !Number.isInteger(month) || month < 1 || month > 12 ||
      !Number.isInteger(day) || day < 1 || day > 31 ||
      !Number.isInteger(hour) || hour < 0 || hour > 23 ||
      !Number.isInteger(minute) || minute < 0 || minute > 59 ||
      !Number.isInteger(second) || second < 0 || second > 59) {
    return {status: 'problem', problem: 'zone_unavailable'};
  }

  // Interpret the formatted civil fields as UTC only to calculate their
  // difference from the captured UTC second. This preserves historic
  // second-level offsets and avoids DST assumptions or host-zone fallbacks.
  const localWallTime = new Date(0);
  localWallTime.setUTCFullYear(year, month - 1, day);
  localWallTime.setUTCHours(hour, minute, second, 0);
  const offsetSeconds = Math.round(
    (localWallTime.getTime() - Math.floor(milliseconds / 1000) * 1000) / 1000,
  );
  const pad = (value: number) => String(value).padStart(2, '0');

  return {
    status: 'ready',
    input: {
      name: cleanChartName(fields.name),
      utcIso,
      localDate: `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`,
      localTime: `${pad(hour)}:${pad(minute)}:${pad(second)}`,
      timeZone,
      offsetSeconds,
      latMicro,
      lngMicro,
      placeName: cleanChartName(fields.placeName),
    },
  };
}


/** Never inherit a prior place's zone when a catalog entry lacks one. */
export function selectedPlaceTimeZone(timeZone: string | null | undefined): string {
  return typeof timeZone === 'string' ? timeZone.trim() : '';
}
