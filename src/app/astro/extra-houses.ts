import {calculateAstroComHouseFromProvider} from 'astrological-functions/astro-com-house-provider';
import type {ChartSnapshotV1, ChartProviderV1} from '../native/chart-calculation-contract';
import type {TemaRenderData} from './tema-render-data';

export const EXTRA_HOUSE_SYSTEM_IDS = Object.freeze([
  'CAMPANUS', 'EQUAL_ASCENDANT', 'EQUAL_MIDHEAVEN', 'WHOLE_SIGN', 'WHOLE_ARIES',
  'MERIDIAN', 'ALCABITIUS', 'KRUSINSKI_PISA_GOELZER', 'AZIMUTH', 'MORINUS', 'POLICH_PAGE',
  'APC', 'PULLEN_SD', 'PULLEN_SR', 'SRIPATI', 'CARTER_POLI_EQUATORIAL', 'SUNSHINE', 'ALBATEGNIUS',
] as const);
export type ExtraHouseSystemId = typeof EXTRA_HOUSE_SYSTEM_IDS[number];

/** Compose the shared house methods with angles actually returned by the native provider. */
export async function addExtraHouses(data: TemaRenderData, snapshot: ChartSnapshotV1,
  provider: ChartProviderV1, utcIso: string, latMicro: number, lngMicro: number): Promise<readonly number[] | null> {
  const context = snapshot.houseAngleContext, house = snapshot.houses[0];
  const sun = snapshot.bodies.find(body => body.id === 'Sun');
  if (!context || !house || !sun || provider.id !== 'virgostars_ephemeris') return null;
  const identity = {engineVersion:provider.engineVersion, kernelSetId:'LOCAL_DE441_UNPINNED', timeModel:'UT1_APPROX_UTC'};
  const common = {datetimeUtc:utcIso, birthTimeKnown:true as const, ut1JulianDay:snapshot.julianDayUt,
    ttJulianDay:context.ttJulianDay, latitudeDeg:latMicro / 1e6, longitudeDegEast:lngMicro / 1e6,
    expectedProvider:identity};
  const angleProvider = {calculateHouseAngles: () => ({...identity, model:'IAU2006_2000B_APPROXIMATE_SIDEREAL_TIME' as const,
    ut1JulianDay:common.ut1JulianDay, ttJulianDay:common.ttJulianDay, latitudeDeg:common.latitudeDeg,
    longitudeDegEast:common.longitudeDegEast, armcDeg:house.armcDeg, ascendantDeg:house.ascendantDeg,
    midheavenDeg:house.mcDeg, trueObliquityDeg:context.trueObliquityDeg})};
  await Promise.all(EXTRA_HOUSE_SYSTEM_IDS.map(async houseSystem => {
    try {
      const request = houseSystem === 'SUNSHINE' ? {...common, houseSystem, sun:{datetimeUtc:utcIso,
        declinationDeg:sun.declinationDeg, modelId:'VIRGOSTARS_EPHEMERIS', bodyId:'SUN' as const,
        frame:'EQUATORIAL_OF_DATE' as const, center:'EARTH' as const, corrections:'APPARENT' as const,
        observerType:'GEOCENTRIC' as const, source:identity}} : {...common, houseSystem};
      const output = await calculateAstroComHouseFromProvider(request, angleProvider);
      const result = output.result;
      if (!('cuspsDeg' in result) || result.cuspsDeg.length !== 12 ||
          !result.cuspsDeg.every(value => Number.isFinite(value) && value >= 0 && value < 360)) return;
      data.houses[houseSystem] = {house:[...result.cuspsDeg], ascendant:house.ascendantDeg,
        mc:house.mcDeg, armc:house.armcDeg, vertex:house.vertexDeg,
        ds:(house.ascendantDeg + 180) % 360, ic:(house.mcDeg + 180) % 360};
    } catch { /* A method may be undefined at this latitude; do not substitute it. */ }
  }));
  try {
    const result = (await calculateAstroComHouseFromProvider({...common, houseSystem:'GAUQUELIN_36'}, angleProvider)).result;
    if ('sectorBoundariesDeg' in result && result.sectorBoundariesDeg.length === 36 &&
        result.sectorBoundariesDeg.every(value => Number.isFinite(value) && value >= 0 && value < 360))
      return Object.freeze([...result.sectorBoundariesDeg]);
  } catch { /* The selected geometry may be undefined for this location. */ }
  return null;
}
