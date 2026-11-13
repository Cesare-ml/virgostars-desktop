import type {OfflinePlaceV1} from './native/offline-places-contract';
import type {CivilCorrectionOutput} from './natal-time-step';

/** Civil time is entered locally, NOT silently converted to UTC with today's offset. */
export type NatalInputKey = 'name' | 'year' | 'month' | 'day' | 'hour' | 'minute';
export type NatalIssue = 'name' | 'date' | 'time' | 'place' | 'time_zone';
export interface LocalBirthCivil {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number | null;
  readonly minute: number | null;
  readonly birthTimeKnown: boolean;
}
export interface PlaceSnapshot {
  readonly source: 'owned-world-cities';
  readonly sourceId: number;
  readonly name: string;
  readonly countryName: string | null;
  readonly countryCode: string | null;
  readonly stateId: number | null;
  readonly region: string | null;
  readonly latMicro: number;
  readonly lngMicro: number;
  readonly timeZone: string | null;
}
export interface NatalDraftPreview {
  readonly protocolVersion: 1;
  readonly name: string;
  readonly civil: LocalBirthCivil;
  readonly place: PlaceSnapshot;
  /** Historical DST rules are not yet resolved. No UTC timestamp is invented. */
  readonly utcResolution: 'pending_historical_tzdb' | 'unknown_birth_time';
}
export type NatalPreviewResult =
  | Readonly<{ok: true; preview: NatalDraftPreview; issues: readonly []}>
  | Readonly<{ok: false; preview: null; issues: readonly NatalIssue[]}>;

function integerField(value: string, min: number, max: number): number | null {
  if (!/^\d{1,4}$/.test(value)) return null;
  const num=Number(value);
  return Number.isSafeInteger(num) && num >= min && num <= max ? num : null;
}
export function gregorianDaysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) return 0;
  if (month === 2) return (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28;
  return [4,6,9,11].includes(month) ? 30 : 31;
}
function plausibleZone(value: string | null): boolean {
  // Syntax check only. Historical IANA tzdb mapping is a separate Rust task.
  return value !== null && value.length <= 100 && (
    value === 'UTC' || /^(?:[A-Za-z_]+\/)+[A-Za-z0-9_+\-]+$/.test(value)
  );
}
function nullableText(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= 255);
}
function nullableNonnegativeInteger(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' &&
    Number.isSafeInteger(value) && value >= 0);
}

/**
 * Revalidate a caller-supplied place at the natal input boundary, even when it
 * bypasses the native lookup decoder. Reject malformed optional metadata before
 * copying it into a birth preview. No geocoding or timezone guessing occurs.
 */
function validPlace(place: OfflinePlaceV1 | null): place is OfflinePlaceV1 {
  return !!place &&
    Number.isSafeInteger(place.id) && place.id > 0 &&
    typeof place.name === 'string' && !!place.name.trim() && place.name.length <= 255 &&
    nullableText(place.italianName) &&
    Number.isSafeInteger(place.latMicro) && Math.abs(place.latMicro) <= 90_000_000 &&
    Number.isSafeInteger(place.lngMicro) && Math.abs(place.lngMicro) <= 180_000_000 &&
    nullableNonnegativeInteger(place.population) &&
    nullableNonnegativeInteger(place.stateId) &&
    nullableText(place.region) &&
    nullableText(place.timeZone) &&
    nullableText(place.countryName) &&
    (place.countryCode === null ||
      (typeof place.countryCode === 'string' && /^[A-Z]{2}$/.test(place.countryCode)));
}

/**
 * In-memory only first vertical slice; no localStorage, HTTP, storage IPC or
 * astronomical calculation. Data is lost on app restart until encrypted
 * guest archive and historical timezone validation are implemented.
 */
export class NatalDraftState {
  name = '';
  year = '';
  month = '';
  day = '';
  hour = '';
  minute = '';
  birthTimeKnown = true;
  place: OfflinePlaceV1 | null = null;
  preview: NatalDraftPreview | null = null;
  issues: readonly NatalIssue[] = [];
  private revision = 0;
  private disposed = false;

  /** Changes whenever a current UTC selection must be invalidated. */
  get inputRevision(): number { return this.revision; }

  update(field: NatalInputKey, value: string): void {
    if (this.disposed) return;
    // Strict upper bound avoids large strings lingering in the renderer.
    this[field] = value.slice(0, field === 'name' ? 160 : 8);
    this.invalidate();
  }

  /** Atomic editor-only wall-clock correction; no actual ephemeris IPC here. */
  applyCivilCorrection(next: CivilCorrectionOutput): void {
    if (this.disposed || !next || typeof next !== 'object') return;
    // Recheck the step output at the state boundary before changing any field.
    // This also covers accidental callers that bypass stepCivilCorrection().
    if (![next.year,next.month,next.day,next.hour,next.minute]
      .every(value => typeof value === 'string')) return;
    const year=integerField(next.year,1,9999);
    const month=integerField(next.month,1,12);
    const day=integerField(next.day,1,31);
    if (year===null || month===null || day===null ||
        day > gregorianDaysInMonth(year,month)) return;
    if (this.birthTimeKnown) {
      if (integerField(next.hour,0,23)===null ||
          integerField(next.minute,0,59)===null) return;
    } else if (next.hour !== this.hour || next.minute !== this.minute) {
      // A date-only correction cannot invent, erase or alter unknown-time fields.
      return;
    }
    this.year=next.year; this.month=next.month; this.day=next.day;
    this.hour=next.hour; this.minute=next.minute;
    this.invalidate();
  }

  setBirthTimeKnown(known: boolean): void {
    if (this.disposed) return;
    this.birthTimeKnown = known;
    this.invalidate();
  }

  setPlace(value: OfflinePlaceV1 | null): void {
    if (this.disposed) return;
    this.place = value;
    this.invalidate();
  }

  validate(): NatalPreviewResult {
    if (this.disposed) return {ok:false,preview:null,issues:[]};
    const issues: NatalIssue[] = [];
    const name=this.name.trim();
    if (!name || name.length > 120) issues.push('name');
    const year=integerField(this.year,1,9999);
    const month=integerField(this.month,1,12);
    const day=integerField(this.day,1,31);
    if (year===null || month===null || day===null || day > gregorianDaysInMonth(year,month)) issues.push('date');
    const hour=this.birthTimeKnown ? integerField(this.hour,0,23) : null;
    const minute=this.birthTimeKnown ? integerField(this.minute,0,59) : null;
    if (this.birthTimeKnown && (hour===null || minute===null)) issues.push('time');
    if (!validPlace(this.place)) issues.push('place');
    // Cannot resolve a known birth instant with a missing or invalid zone.
    if (validPlace(this.place) && this.birthTimeKnown && !plausibleZone(this.place.timeZone)) issues.push('time_zone');
    if (issues.length || year===null || month===null || day===null || !validPlace(this.place)) {
      return {ok:false,preview:null,issues};
    }
    const place=this.place;
    const snapshot: NatalDraftPreview={
      protocolVersion:1,
      name,
      civil:{year,month,day,hour,minute,birthTimeKnown:this.birthTimeKnown},
      place:{
        source:'owned-world-cities',sourceId:place.id,name:place.name,
        countryName:place.countryName,countryCode:place.countryCode,stateId:place.stateId,
        region:place.region,latMicro:place.latMicro,lngMicro:place.lngMicro,
        timeZone:place.timeZone,
      },
      utcResolution:this.birthTimeKnown ? 'pending_historical_tzdb' : 'unknown_birth_time'
    };
    return {ok:true,preview:snapshot,issues:[]};
  }

  showPreview(): boolean {
    if (this.disposed) return false;
    const result=this.validate();
    this.issues=result.issues;
    this.preview=result.ok ? result.preview : null;
    return result.ok;
  }

  clear(): void {
    if (this.disposed) return;
    this.name='';this.year='';this.month='';this.day='';this.hour='';this.minute='';
    this.birthTimeKnown=true;
    this.place=null;
    this.invalidate();
  }

  /** Retire this session without keeping a natal draft reachable from the shell. */
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed=true;
  }

  private invalidate(): void {
    this.revision++;
    this.preview=null;
    this.issues=[];
  }
}
