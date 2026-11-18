import type {HistoricalCalendarRequest} from './native/historical-calendar-contract';
import type {HistoricalBody, HistoricalPlanet, HistoricalResult} from './native/historical-planets-contract';

type Failure = Exclude<HistoricalResult['kind'], 'ready'>;
export type PlanetSetResult = Readonly<{kind: 'ready'; planets: readonly HistoricalPlanet[]}> |
  Readonly<{kind: 'failed'; body: HistoricalBody; reason: Failure}> | Readonly<{kind: 'cancelled'}>;

/** One epoch and one source for all bodies; do not present a partial set. */
export async function calculatePlanetSet(
  request: HistoricalCalendarRequest,
  bodies: readonly HistoricalBody[],
  calculate: (request: HistoricalCalendarRequest) => Promise<HistoricalResult>,
  cancelled: () => boolean,
): Promise<PlanetSetResult> {
  const planets: HistoricalPlanet[] = [];
  for (const body of bodies) {
    if (cancelled()) return {kind:'cancelled'};
    let result: HistoricalResult;
    try { result = await calculate({...request, body}); }
    catch { result = {kind:'unavailable'}; }
    if (cancelled()) return {kind:'cancelled'};
    if (result.kind !== 'ready') return {kind:'failed', body, reason:result.kind};
    const p = result.planet;
    const first = planets[0];
    if (p.body !== body || (first && (p.jdUt1 !== first.jdUt1 || p.jdTt !== first.jdTt || p.jdTdb !== first.jdTdb ||
        p.deltaTSeconds !== first.deltaTSeconds || p.uncertaintySeconds !== first.uncertaintySeconds ||
        p.deltaTSource !== first.deltaTSource || p.uncertaintySource !== first.uncertaintySource ||
        p.usnoSourceError?.seconds !== first.usnoSourceError?.seconds))) {
      return {kind:'failed', body, reason:'unavailable'};
    }
    planets.push(p);
  }
  return {kind:'ready', planets:Object.freeze(planets)};
}
