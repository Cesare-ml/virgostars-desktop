import type {CivilTimeInput, CivilTimeResult} from './civil-time';

/** The website stores a civil date/time. UTC can only be used when justified. */
export type SyncedBirth = Readonly<{
  localDate: string; localTime: string | null; timeUnknown: boolean; timeZoneIana: string | null;
  resolvedInstantUtc: string | null; utcOffsetSeconds: number | null;
}>;
export type SyncedBirthResult =
  | Readonly<{kind:'unknown'; source: SyncedBirth}>
  | Readonly<{kind:'resolved'; source: SyncedBirth; instantUtc: string}>
  | Readonly<{kind:'review'; source: SyncedBirth; reason: 'missing_time' | 'missing_zone' | 'ambiguous' | 'nonexistent' | 'unsupported' | 'inconsistent_instant'}>
  | Readonly<{kind:'invalid'}>;

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year=Number(value.slice(0,4)), month=Number(value.slice(5,7)), day=Number(value.slice(8,10));
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31][month-1];
}

/**
 * Preserve unknown time explicitly. Never select one side of a DST fold, move
 * a nonexistent time or substitute midnight for an unknown birth time.
 */
export function classifySyncedBirth(input: SyncedBirth,
  resolve: (input: CivilTimeInput) => CivilTimeResult): SyncedBirthResult {
  if (!input || !validDate(input.localDate) || typeof input.timeUnknown !== 'boolean' ||
      !(input.localTime === null || (typeof input.localTime === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(input.localTime))) ||
      !(input.timeZoneIana === null || (typeof input.timeZoneIana === 'string' && input.timeZoneIana.length > 0 && input.timeZoneIana.length <= 80)) ||
      !(input.resolvedInstantUtc === null || typeof input.resolvedInstantUtc === 'string') ||
      !(input.utcOffsetSeconds === null || (Number.isInteger(input.utcOffsetSeconds) && Math.abs(input.utcOffsetSeconds) <= 50400))) return {kind:'invalid'};
  const source: SyncedBirth = Object.freeze({localDate:input.localDate,localTime:input.localTime,
    timeUnknown:input.timeUnknown,timeZoneIana:input.timeZoneIana,
    resolvedInstantUtc:input.resolvedInstantUtc,utcOffsetSeconds:input.utcOffsetSeconds});
  if (input.timeUnknown) {
    if (input.localTime !== null || input.resolvedInstantUtc !== null || input.utcOffsetSeconds !== null) return {kind:'invalid'};
    return {kind:'unknown',source};
  }
  if (input.localTime === null) return {kind:'review',source,reason:'missing_time'};
  if (input.timeZoneIana === null) return {kind:'review',source,reason:'missing_zone'};
  const result=resolve({date:input.localDate,time:input.localTime,timeZone:input.timeZoneIana});
  if (result.status === 'invalid') return {kind:'review',source,reason:'unsupported'};
  if (result.status === 'nonexistent') return {kind:'review',source,reason:'nonexistent'};
  const possible = result.status === 'ambiguous' ? result.choices : [result.choice];
  if (input.resolvedInstantUtc !== null || input.utcOffsetSeconds !== null) {
    const found=possible.find(c => c.instantUtc === input.resolvedInstantUtc && c.offsetSeconds === input.utcOffsetSeconds);
    if (!found) return {kind:'review',source,reason:'inconsistent_instant'};
    return {kind:'resolved',source,instantUtc:found.instantUtc};
  }
  if (result.status === 'ambiguous') return {kind:'review',source,reason:'ambiguous'};
  return {kind:'resolved',source,instantUtc:result.choice.instantUtc};
}
