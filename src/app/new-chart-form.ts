/**
 * Pure validation for the "new chart" form. No astronomy and no storage:
 * it turns what was typed into one UTC instant and one position, or says
 * exactly which field stops it. The civil-time resolver is injected.
 */
import type {CivilTimeChoice, CivilTimeInput, CivilTimeResult} from './native/civil-time';
import type {SavedChartV1} from './native/chart-archive-contract';
import type {HistoricalChartRequest} from './native/historical-chart-contract';
import {validHistoricalChartRequest} from './native/historical-chart-validation.mjs';

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
  historical?: HistoricalChartRequest & Readonly<{protocolVersion:1}>;
  timeUnknown?: boolean;
  unknownDate?: string;
}>;

export type NewChartProblem =
  | 'date_invalid' | 'time_invalid' | 'zone_invalid' | 'zone_unavailable'
  | 'latitude_invalid' | 'longitude_invalid' | 'time_nonexistent' | 'historical_invalid';

export type NewChartResolution =
  | Readonly<{status: 'ready'; input: NewChartInput}>
  | Readonly<{status: 'choice_required'; choices: readonly CivilTimeChoice[]}>
  | Readonly<{status: 'problem'; problem: NewChartProblem}>;

export const MAX_CHART_NAME_LENGTH = 80;

/** Recover editable local birth fields from the persisted UTC instant and IANA zone. */
export function savedChartFields(chart: SavedChartV1): NewChartFields {
  if (chart.unknownDate) return {name:chart.name,date:chart.unknownDate,time:'12:00:00',timeZone:chart.timeZone,
    latitude:(chart.latMicro / 1e6).toFixed(6),longitude:(chart.lngMicro / 1e6).toFixed(6),placeName:chart.placeName};
  if (chart.historical) {
    const c=chart.historical.civil, pad=(n:number)=>String(n).padStart(2,'0');
    const secondText=String(c.second).includes('e') ? c.second.toFixed(9) : String(c.second);
    const fraction=secondText.split('.')[1];
    const seconds=pad(Math.floor(c.second))+(fraction ? `.${fraction}` : '');
    return {name:chart.name, date:`${c.year}-${pad(c.month)}-${pad(c.day)}`,
      time:`${pad(c.hour)}:${pad(c.minute)}:${seconds}`, timeZone:'',
      latitude:(chart.latMicro / 1e6).toFixed(6), longitude:(chart.lngMicro / 1e6).toFixed(6), placeName:chart.placeName};
  }
  // Older archives may contain a syntactically acceptable but unsupported IANA zone.
  // Keep the editor usable so that the user can correct that value rather than crashing.
  const formatting = {year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'} as const;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {timeZone:chart.timeZone, ...formatting})
      .formatToParts(new Date(chart.utcIso));
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', {timeZone:'UTC', ...formatting})
      .formatToParts(new Date(chart.utcIso));
  }
  const value = (key: string) => parts.find(part => part.type === key)?.value ?? '';
  return {
    name:chart.name,
    date:`${value('year').padStart(4, '0')}-${value('month')}-${value('day')}`,
    time:`${value('hour')}:${value('minute')}:${value('second')}`,
    timeZone:chart.timeZone,
    latitude:(chart.latMicro / 1e6).toFixed(6),
    longitude:(chart.lngMicro / 1e6).toFixed(6),
    placeName:chart.placeName,
  };
}

export type HistoricalFormOptions = Readonly<{calendar:'gregorian'|'julian'; offset:'localMeanSolar'|'supplied';
  offsetSeconds:string; deltaT:'espenakMeeus2006'|'supplied'; deltaTSeconds:string;
  civilUncertaintySeconds:string; deltaTUncertaintySeconds:string; offsetSource?:string; deltaTSource?:string}>;

/** Explicit historical local-clock choice; no UTC or timezone is fabricated. */
export function resolveHistoricalNewChart(fields:NewChartFields, options:HistoricalFormOptions):NewChartResolution {
  const latMicro=parseDegreesMicro(fields.latitude,90), lngMicro=parseDegreesMicro(fields.longitude,180);
  if (latMicro === null) return {status:'problem',problem:'latitude_invalid'};
  if (lngMicro === null) return {status:'problem',problem:'longitude_invalid'};
  const date=/^(-?\d{1,5})-(\d{2})-(\d{2})$/.exec(fields.date.trim());
  if (!date) return {status:'problem',problem:'date_invalid'};
  const time=/^(\d{2}):(\d{2})(?::(\d{2}(?:\.\d{1,9})?))?$/.exec(fields.time.trim());
  if (!time) return {status:'problem',problem:'time_invalid'};
  const number=(text:string)=>text.trim() === '' ? NaN : Number(text.replace(',','.'));
  const request:HistoricalChartRequest={civil:{year:Number(date[1]),month:Number(date[2]),day:Number(date[3]),
    hour:Number(time[1]),minute:Number(time[2]),second:Number(time[3] ?? 0), calendar:options.calendar,
    offset:options.offset === 'localMeanSolar' ? {kind:'localMeanSolar'} :
      {kind:'supplied', secondsEast:number(options.offsetSeconds), source:options.offsetSource ?? 'User supplied local minus UT1'},
    uncertaintySeconds:number(options.civilUncertaintySeconds)},
    deltaT:options.deltaT === 'espenakMeeus2006' ? {kind:'espenakMeeus2006',uncertaintySeconds:number(options.deltaTUncertaintySeconds)} :
      {kind:'supplied',seconds:number(options.deltaTSeconds),uncertaintySeconds:number(options.deltaTUncertaintySeconds),source:options.deltaTSource ?? 'User supplied'},
    latMicro,lngMicro};
  if (!validHistoricalChartRequest(request)) return {status:'problem',problem:'historical_invalid'};
  return {status:'ready',input:{name:cleanChartName(fields.name), utcIso:'', localDate:fields.date, localTime:fields.time,
    timeZone:'', offsetSeconds:0, latMicro,lngMicro,placeName:cleanPlaceName(fields.placeName),historical:{protocolVersion:1,...request}}};
}

/** Strip control characters and trim; the name is display-only text. */
export function cleanChartName(raw: string): string {
  return [...String(raw ?? '')].filter(ch => ch >= ' ' && ch !== '\u007f').join('')
    .trim().slice(0, MAX_CHART_NAME_LENGTH);
}

export function cleanPlaceName(raw: string): string {
  return [...String(raw ?? '')].filter(ch => ch >= ' ' && ch !== '\u007f').join('').trim().slice(0, 160);
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
      placeName: cleanPlaceName(fields.placeName),
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
