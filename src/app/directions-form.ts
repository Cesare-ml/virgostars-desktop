import moment from 'moment-timezone';

export type DirectionMode = 'SYMBOLIC' | 'SIMPLIFIED_PRIMARY' | 'SECONDARY_PROGRESSION';
export type DirectionPlan = Readonly<{degreeOffset:number; directedUtcMillis:number|null}>;
type DirectionCalculator = (input:{mode:DirectionMode; elapsedYears:number; natalUtcMillis:number; birthTimeKnown:true}) => DirectionPlan;

/** Regolo's fractional calendar-year difference, using the radix UTC time of day. */
export function makeDirectionPlan(natalUtcIso:string, targetDate:string, mode:DirectionMode, calculate:DirectionCalculator): DirectionPlan | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return null;
  const birth = moment.utc(natalUtcIso, moment.ISO_8601, true);
  if (!birth.isValid()) return null;
  const target = moment.utc(targetDate + 'T' + birth.format('HH:mm:ss.SSS') + 'Z', moment.ISO_8601, true);
  if (!target.isValid()) return null;
  try { return calculate({mode, elapsedYears:target.diff(birth, 'years', true), natalUtcMillis:birth.valueOf(), birthTimeKnown:true}); }
  catch { return null; }
}
