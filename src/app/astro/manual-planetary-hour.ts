import { buildPlanetaryHours, lookupPlanetaryHour, type ChaldeanRuler, type PlanetaryWeekday } from 'astrological-functions/planetary-hours';
import { localParts, utcInstantsOfLocal } from '../sky-navigator';

/** User-provided solar-event clock readings in the selected chart's time zone.
 * No astronomical times are estimated or fetched by this adapter. */
export type ManualSolarClockInputs = Readonly<{
  sunriseLocal: string;
  sunsetLocal: string;
  nextSunriseLocal: string;
}>;

export type ManualPlanetaryHourResult =
  | Readonly<{status:'READY'; ruler:ChaldeanRuler; number:number; segment:'DAY'|'NIGHT'; startUtc:string; endUtc:string}>
  | Readonly<{status:'INCOMPLETE'|'INVALID_CLOCK'|'AMBIGUOUS_CLOCK'|'OUTSIDE_INTERVAL'; ruler:null}>;

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const WEEKDAYS: Record<string, PlanetaryWeekday> = {
  Sunday:'SUNDAY', Monday:'MONDAY', Tuesday:'TUESDAY', Wednesday:'WEDNESDAY',
  Thursday:'THURSDAY', Friday:'FRIDAY', Saturday:'SATURDAY',
};

type SolarClockInstant = Readonly<{status:'VALID'; utcMs:number}> |
  Readonly<{status:'INVALID_CLOCK'|'AMBIGUOUS_CLOCK'}>;

function utcOfLocalInput(value: string, zone: string): SolarClockInstant {
  const match = LOCAL_INPUT.exec(value);
  if (!match) return {status:'INVALID_CLOCK'};
  const [year,month,day,hour,minute] = match.slice(1).map(Number);
  if (year < 1900 || year > 2033 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return {status:'INVALID_CLOCK'};
  const instants = utcInstantsOfLocal({year,month,day,hour,minute,second:0}, zone);
  // Neither a missing spring-forward hour nor a repeated fall-back hour has
  // a unique UTC meaning in an HTML datetime-local input (no UTC offset).
  if (!instants.length) return {status:'INVALID_CLOCK'};
  if (instants.length !== 1) return {status:'AMBIGUOUS_CLOCK'};
  const instant = instants[0];
  const check = localParts(instant, zone);
  return check && check.year === year && check.month === month && check.day === day &&
    check.hour === hour && check.minute === minute && check.second === 0
    ? {status:'VALID',utcMs:instant} : {status:'INVALID_CLOCK'};
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
  if ([sunrise,sunset,nextSunrise].some(value => value.status === 'AMBIGUOUS_CLOCK')) {
    return {status:'AMBIGUOUS_CLOCK',ruler:null};
  }
  if (sunrise.status !== 'VALID' || sunset.status !== 'VALID' || nextSunrise.status !== 'VALID' || !Number.isFinite(at)) {
    return {status:'INVALID_CLOCK', ruler:null};
  }
  const sunriseMs = sunrise.utcMs, sunsetMs = sunset.utcMs, nextSunriseMs = nextSunrise.utcMs;
  if (nextSunriseMs - sunriseMs < 20 * 3_600_000 || nextSunriseMs - sunriseMs > 28 * 3_600_000) {
    return {status:'INVALID_CLOCK',ruler:null};
  }
  const weekdayName = new Intl.DateTimeFormat('en-US', {timeZone,weekday:'long'}).format(new Date(sunriseMs));
  const weekday = WEEKDAYS[weekdayName];
  if (!weekday) return {status:'INVALID_CLOCK', ruler:null};
  try {
    const schedule = buildPlanetaryHours({
      availability:'AVAILABLE',weekday,
      sunriseUtc:new Date(sunriseMs).toISOString(),
      sunsetUtc:new Date(sunsetMs).toISOString(),
      nextSunriseUtc:new Date(nextSunriseMs).toISOString(),
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
