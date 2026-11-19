import type {SolarDayV1} from '../native/chart-calculation-contract';

type Schedule = {availability: string; hours: readonly {segment: string; ruler: string; startUtc: string}[]};
type Builder = (input: {availability: 'AVAILABLE'; weekday: string; sunriseUtc: string; sunsetUtc: string; nextSunriseUtc: string}) => Schedule;
type RendererHour = {dataora: string; alba: string; tramonto: string; albaSucc: string;
  dh: {diurne: {dataora: string; pianeta: string}[]; notturne: {dataora: string; pianeta: string}[]}};

/** Adapt the shared unequal-hour schedule to the chart renderer's existing contract. */
export function rendererPlanetaryHours(day: SolarDayV1, instant: string, zone: string, build: Builder): RendererHour | null {
  try {
    const iso = (jd: number) => new Date(Math.round((jd - 2440587.5) * 86400000)).toISOString();
    const alba = iso(day.sunriseJdUt), tramonto = iso(day.sunsetJdUt), albaSucc = iso(day.nextSunriseJdUt);
    const weekday = new Intl.DateTimeFormat('en-US', {timeZone: zone, weekday: 'long'}).format(new Date(alba)).toUpperCase();
    const schedule = build({availability:'AVAILABLE', weekday, sunriseUtc:alba, sunsetUtc:tramonto, nextSunriseUtc:albaSucc});
    if (schedule.availability !== 'AVAILABLE' || schedule.hours.length !== 24) return null;
    const entries = (segment: string) => schedule.hours.filter(hour => hour.segment === segment)
      .map(hour => ({dataora:hour.startUtc, pianeta:hour.ruler[0] + hour.ruler.slice(1).toLowerCase()}));
    return {dataora:instant, alba, tramonto, albaSucc, dh:{diurne:entries('DAY'), notturne:entries('NIGHT')}};
  } catch { return null; }
}
