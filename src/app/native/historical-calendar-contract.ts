import {decodeHistoricalPlanet, HISTORICAL_BODIES, type HistoricalBody, type HistoricalResult} from './historical-planets-contract';

export type DeltaTChoice = Readonly<{kind: 'supplied'; seconds: number; uncertaintySeconds: number; source: string}> |
  Readonly<{kind: 'espenakMeeus2006'; uncertaintySeconds: number}>;
/** Calendar values are UT1, on the proleptic Gregorian calendar, using astronomical year numbering. */
export type HistoricalCalendarRequest = Readonly<{body: HistoricalBody; year: number; month: number; day: number;
  hour: number; minute: number; second: number; deltaT: DeltaTChoice}>;
export interface HistoricalCalendarTransport {
  isNative(): boolean;
  invoke(command: 'calculate_historical_planet_calendar', args: {request: HistoricalCalendarRequest & {protocolVersion: 1}}): Promise<unknown>;
}
export function validHistoricalCalendar(value: HistoricalCalendarRequest): boolean {
  if (!value || !HISTORICAL_BODIES.includes(value.body) || !Number.isInteger(value.year) || value.year < -12999 || value.year > 3999 ||
      !Number.isInteger(value.month) || value.month < 1 || value.month > 12 || !Number.isInteger(value.day) ||
      !Number.isInteger(value.hour) || value.hour < 0 || value.hour > 23 ||
      !Number.isInteger(value.minute) || value.minute < 0 || value.minute > 59 ||
      !Number.isFinite(value.second) || value.second < 0 || value.second >= 60) return false;
  const leap = value.year % 4 === 0 && (value.year % 100 !== 0 || value.year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (value.day < 1 || value.day > monthDays[value.month - 1]) return false;
  const choice = value.deltaT;
  if (!choice || !Number.isFinite(choice.uncertaintySeconds) || choice.uncertaintySeconds < 0) return false;
  if (choice.kind === 'espenakMeeus2006') return value.year >= 0 && value.year <= 3000;
  return choice.kind === 'supplied' && Number.isFinite(choice.seconds) && typeof choice.source === 'string' &&
    choice.source.trim().length > 0 && new TextEncoder().encode(choice.source).length <= 200;
}
export async function requestHistoricalCalendar(transport: HistoricalCalendarTransport, request: HistoricalCalendarRequest): Promise<HistoricalResult> {
  try {
    if (!validHistoricalCalendar(request)) return {kind: 'invalid_request'};
    if (!transport.isNative()) return {kind: 'not_native'};
    const deltaT = request.deltaT.kind === 'supplied'
      ? {kind: 'supplied' as const, seconds: request.deltaT.seconds, uncertaintySeconds: request.deltaT.uncertaintySeconds, source: request.deltaT.source}
      : {kind: 'espenakMeeus2006' as const, uncertaintySeconds: request.deltaT.uncertaintySeconds};
    const raw = await transport.invoke('calculate_historical_planet_calendar', {request: {protocolVersion: 1,
      body: request.body, year: request.year, month: request.month, day: request.day, hour: request.hour,
      minute: request.minute, second: request.second, deltaT}});
    return decodeHistoricalPlanet(raw, {body: request.body, uncertaintySeconds: deltaT.uncertaintySeconds,
      deltaTSource: deltaT.kind === 'supplied' ? deltaT.source : 'Espenak-Meeus 2006',
      ...(deltaT.kind === 'supplied' ? {deltaTSeconds: deltaT.seconds} : {})});
  } catch { return {kind: 'unavailable'}; }
}
