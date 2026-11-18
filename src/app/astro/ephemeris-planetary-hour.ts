import {
  preparePlanetaryHoursFromSolarEvents, type SolarEventAdapterInput,
} from 'astrological-functions/planetary-hours-solar-adapter';
import { lookupPlanetaryHour, type ChaldeanRuler, type PlanetaryWeekday } from 'astrological-functions/planetary-hours';

/** Pure consumer boundary for a future read-only native solar-event command.
 * A caller-provided engine descriptor is NOT a scientific verification. */
export interface NatalSolarContext {
  readonly utcIso: string;
  readonly timeZone: string;
  readonly latMicro: number;
  readonly lngMicro: number;
}

export type EphemerisPlanetaryHourResult =
  | Readonly<{
      status:'READY'; ruler:ChaldeanRuler; number:number; startUtc:string; endUtc:string;
      provenance: 'CALLER_ASSERTED_NOT_SCIENTIFICALLY_VERIFIED';
      model: SolarEventAdapterInput['model'];
      source: SolarEventAdapterInput['source'];
    }>
  | Readonly<{
      status:'INVALID_SOURCE'|'MISMATCHED_OBSERVER'|'WEEKDAY_MISMATCH'|'OUTSIDE_INTERVAL'|'UNAVAILABLE';
      ruler:null;
    }>;

const WEEKDAYS: Record<string, PlanetaryWeekday> = {
  Sunday:'SUNDAY',Monday:'MONDAY',Tuesday:'TUESDAY',Wednesday:'WEDNESDAY',
  Thursday:'THURSDAY',Friday:'FRIDAY',Saturday:'SATURDAY',
};
const MICRO_DEGREES = 1_000_000;
const OBSERVER_TOLERANCE_DEG = 0.00001; // ~1 m, enough for serialized observer rounding.

export function resolveEphemerisPlanetaryHour(
  chart: NatalSolarContext,
  snapshot: SolarEventAdapterInput,
): EphemerisPlanetaryHourResult {
  try {
    if (!chart || !snapshot || !Number.isInteger(chart.latMicro) || !Number.isInteger(chart.lngMicro) ||
      Math.abs(chart.latMicro) > 90 * MICRO_DEGREES || Math.abs(chart.lngMicro) > 180 * MICRO_DEGREES) {
      return {status:'INVALID_SOURCE',ruler:null};
    }
    // Confirm that the source's observatory is the natal chart's place;
    // otherwise perfectly valid sunrise times belong to the wrong city.
    const lat = chart.latMicro / MICRO_DEGREES;
    const lon = chart.lngMicro / MICRO_DEGREES;
    if (!snapshot.observer || Math.abs(snapshot.observer.latitudeDeg - lat) > OBSERVER_TOLERANCE_DEG ||
      Math.abs(snapshot.observer.longitudeDegEast - lon) > OBSERVER_TOLERANCE_DEG) {
      return {status:'MISMATCHED_OBSERVER',ruler:null};
    }
    const prepared = preparePlanetaryHoursFromSolarEvents(snapshot);
    if (snapshot.events.availability === 'UNAVAILABLE') return {status:'UNAVAILABLE',ruler:null};
    const sunrise = new Date(snapshot.events.sunriseUtc);
    if (!Number.isFinite(sunrise.getTime())) return {status:'INVALID_SOURCE',ruler:null};
    const localWeekday = new Intl.DateTimeFormat('en-US', {
      timeZone:chart.timeZone, weekday:'long',
    }).format(sunrise);
    // The timestamp's UTC weekday may differ from sunrise's LOCAL weekday.
    if (WEEKDAYS[localWeekday] !== snapshot.weekday) return {status:'WEEKDAY_MISMATCH',ruler:null};
    const found = lookupPlanetaryHour({schedule:prepared.schedule,instantUtc:chart.utcIso});
    if (found.status !== 'FOUND') return {status:'OUTSIDE_INTERVAL',ruler:null};
    return {
      status:'READY',ruler:found.hour.ruler,number:found.hour.number,
      startUtc:found.hour.startUtc,endUtc:found.hour.endUtc,
      provenance:prepared.scientificEvidence,model:prepared.model,source:prepared.source,
    };
  } catch {
    return {status:'INVALID_SOURCE',ruler:null};
  }
}
