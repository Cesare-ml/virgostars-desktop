import type {LocalBirthCivil} from './natal-draft-state';

/**
 * Moment Timezone unpacked zone contract. Offsets are minutes WEST of UTC.
 * Pure and independent of any particular bundled tzdb runtime.
 */
export interface TimezoneIntervals {
  readonly name: string;
  readonly untils: readonly (number | null)[];
  readonly offsets: readonly number[];
}
export interface UtcCandidate {
  readonly epochMs: number;
  readonly isoUtc: string;
  /** Minutes EAST of UTC; positive for Europe/Rome summer time. */
  readonly offsetMinutesEast: number;
}
export type CivilTimeStatus =
  | 'unique' | 'ambiguous' | 'nonexistent' | 'zone_missing'
  | 'invalid_date' | 'unknown_birth_time' | 'invalid_zone_data';
export type TimezoneCaution = 'pre_1970' | 'future_rules' | null;
export interface CivilTimeResolution {
  readonly status: CivilTimeStatus;
  readonly timezone: string | null;
  readonly tzdbVersion: string;
  readonly caution: TimezoneCaution;
  /** 0 = nonexistent, 1 = unique, >=2 = explicit user decision required. */
  readonly candidates: readonly UtcCandidate[];
}

function validDate(c: LocalBirthCivil): boolean {
  if (![c.year, c.month, c.day].every(Number.isInteger) ||
      c.year < 1 || c.year > 9999 || c.month < 1 || c.month > 12 ||
      c.day < 1 || c.day > 31) return false;
  const dayCount=c.month === 2
    ? (c.year % 4 === 0 && (c.year % 100 !== 0 || c.year % 400 === 0) ? 29 : 28)
    : ([4,6,9,11].includes(c.month) ? 30 : 31);
  return c.day <= dayCount;
}

/** Date.UTC(0..99) maps those years to 1900..1999; setUTCFullYear avoids it. */
function civilWallMillis(c: LocalBirthCivil): number {
  const d=new Date(0);
  d.setUTCFullYear(c.year,c.month-1,c.day);
  d.setUTCHours(c.hour!,c.minute!,0,0);
  return d.getTime();
}

function intervalIndex(untils: readonly (number | null)[], instant: number): number {
  let low=0,high=untils.length-1;
  while(low<high) {
    const mid=Math.floor((low+high)/2);
    const upper=untils[mid] ?? Infinity;
    if(instant < upper) high=mid;
    else low=mid+1;
  }
  return low;
}

function plausibleZoneIntervals(zone: TimezoneIntervals): boolean {
  if (!zone.offsets.length || zone.offsets.length !== zone.untils.length ||
      zone.offsets.length > 50_000) return false;
  let previous=-Infinity;
  for(let i=0;i<zone.untils.length;i++) {
    const offset=zone.offsets[i];
    const end=zone.untils[i] ?? Infinity;
    if (!Number.isFinite(offset) || Math.abs(offset)>24*60 ||
        end <= previous ||
        (i<zone.untils.length-1 && !Number.isFinite(end))) return false;
    previous=end;
  }
  return true;
}

/**
 * Enumerate valid offsets and invert local wall time to UTC. This never uses
 * Moment's implicit "move gaps forward / choose first fold" parse behavior.
 *
 * Historical accuracy depends on the supplied tzdb pack. Caution is mandatory
 * before 1970 and for far-future speculative civil rules.
 */
export function resolveCivilTime(
  civil: LocalBirthCivil, zone: TimezoneIntervals | null, tzdbVersion: string
): CivilTimeResolution {
  const caution:TimezoneCaution = civil.year < 1970 ? 'pre_1970'
    : civil.year > 2037 ? 'future_rules' : null;
  const base={
    timezone:zone?.name ?? null,
    tzdbVersion:tzdbVersion || 'unknown',
    caution,
  };
  if(!validDate(civil)) return {...base,status:'invalid_date',candidates:[]};
  if(!civil.birthTimeKnown) return {...base,status:'unknown_birth_time',candidates:[]};
  if(!Number.isInteger(civil.hour) || !Number.isInteger(civil.minute) ||
     civil.hour===null || civil.minute===null || civil.hour<0 || civil.hour>23 ||
     civil.minute<0 || civil.minute>59) {
    return {...base,status:'invalid_date',candidates:[]};
  }
  if(!zone) return {...base,status:'zone_missing',candidates:[]};
  if(!plausibleZoneIntervals(zone)) return {...base,status:'invalid_zone_data',candidates:[]};

  const wallMs=civilWallMillis(civil);
  const candidates:UtcCandidate[]=[];
  // Typically only 2-5 distinct offsets per zone, even if many transitions.
  for(const west of new Set(zone.offsets)) {
    const epochMs=Math.round(wallMs+west*60_000);
    const interval=intervalIndex(zone.untils,epochMs);
    const lower=interval===0 ? -Infinity : (zone.untils[interval-1] ?? Infinity);
    const upper=zone.untils[interval] ?? Infinity;
    if(epochMs < lower || epochMs >= upper || zone.offsets[interval] !== west) continue;
    const date=new Date(epochMs);
    if(!Number.isFinite(date.getTime())) continue;
    candidates.push({
      epochMs,isoUtc:date.toISOString(),offsetMinutesEast:-west,
    });
  }
  candidates.sort((a,b)=>a.epochMs-b.epochMs);
  const deduped=candidates.filter((value,index)=>index===0 || value.epochMs!==candidates[index-1].epochMs);
  return {
    ...base,
    status:deduped.length===0 ? 'nonexistent' : deduped.length===1 ? 'unique' : 'ambiguous',
    candidates:deduped,
  };
}
