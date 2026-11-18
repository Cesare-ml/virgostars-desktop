import { buildPlanetaryHours, lookupPlanetaryHour, type ChaldeanRuler, type PlanetaryWeekday } from 'astrological-functions/planetary-hours';
import { localParts, utcFromLocal } from '../sky-navigator';

/** User-provided solar-event clock readings in the selected chart's time zone.
 * No astronomical times are estimated or fetched by this adapter. */
export type ManualSolarClockInputs = Readonly<{
  sunriseLocal: string;
  sunsetLocal: string;
  nextSunriseLocal: string;
}>;

export type ManualPlanetaryHourResult =
  | Readonly<{status:'READY'; ruler:ChaldeanRuler; number:number; segment:'DAY'|'NIGHT'; startUtc:string; endUtc:string}>
  | Readonly<{status:'INCOMPLETE'|'INVALID_CLOCK'|'OUTSIDE_INTERVAL'; ruler:null}>;

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const WEEKDAYS: Record<string, PlanetaryWeekday> = {
  Sunday:'SUNDAY', Monday:'MONDAY', Tuesday:'TUESDAY', Wednesday:'WEDNESDAY',
  Thursday:'THURSDAY', Friday:'FRIDAY', Saturday:'SATURDAY',
};

function utcOfLocalInput(value: string, zone: string): number | null {
  const match = LOCAL_INPUT.exec(value);
  if (!match) return null;
  const [year,month,day,hour,minute] = match.slice(1).map(Number);
  if (year < 1900 || year > 2033 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const instant = utcFromLocal({year,month,day,hour,minute,second:0}, zone);
  if (instant === null) return null;
  // Refuse impossible local times, including DST spring-forward gaps, instead
  // of silently shifting a source event to another clock reading.
  const check = localParts(instant, zone);
  return check && check.year === year && check.month === month && check.day === day &&
    check.hour === hour && check.minute === minute && check.second === 0 ? instant : null;
}

/** Resolve the exact natal instant, not the device clock, using the shared
 * Chaldean seasonal-hours algorithm and caller-supplied sunrise/sunset. */
export function resolveManualPlanetaryHour(
  eventUtcIso: string,
  timeZone: string,
  solar: ManualSolarClockInputs,
): ManualPlanetaryHourResult {
  if (!solar.sunriseLocal || !solar.sunsetLocal || !solar.nextSunriseLocal) {
    return {status:'INCOMPLETE', ruler:null};
  }
  const sunrise = utcOfLocalInput(solar.sunriseLocal, timeZone);
  const sunset = utcOfLocalInput(solar.sunsetLocal, timeZone);
  const nextSunrise = utcOfLocalInput(solar.nextSunriseLocal, timeZone);
  const at = Date.parse(eventUtcIso);
  if (sunrise === null || sunset === null || nextSunrise === null || !Number.isFinite(at) ||
      nextSunrise - sunrise < 20 * 3_600_000 || nextSunrise - sunrise > 28 * 3_600_000) {
    return {status:'INVALID_CLOCK', ruler:null};
  }
  const weekdayName = new Intl.DateTimeFormat('en-US', {timeZone,weekday:'long'}).format(new Date(sunrise));
  const weekday = WEEKDAYS[weekdayName];
  if (!weekday) return {status:'INVALID_CLOCK', ruler:null};
  try {
    const schedule = buildPlanetaryHours({
      availability:'AVAILABLE',weekday,
      sunriseUtc:new Date(sunrise).toISOString(),
      sunsetUtc:new Date(sunset).toISOString(),
      nextSunriseUtc:new Date(nextSunrise).toISOString(),
    });
    const result = lookupPlanetaryHour({schedule, instantUtc:new Date(at).toISOString()});
    if (result.status !== 'FOUND') return {status:'OUTSIDE_INTERVAL',ruler:null};
    return {
      status:'READY',ruler:result.hour.ruler,number:result.hour.number,
      segment:result.hour.segment,startUtc:result.hour.startUtc,endUtc:result.hour.endUtc,
    };
  } catch {
    return {status:'INVALID_CLOCK',ruler:null};
  }
}
