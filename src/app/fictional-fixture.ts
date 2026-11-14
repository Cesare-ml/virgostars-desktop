import { TemaRender } from 'grafici-astrologici';
import {
  fictionalAngles, fictionalPlanetPositions, fictionalHousePositions,
  type DemoPlanet,
} from './demo-presets';
export { DEMO_NAMES, type DemoPlanet } from './demo-presets';

// Original, deliberately fictional test data. Never label these as astronomical ephemerides
// or use them for real birth chart interpretation.
export function makeFictionalTheme(shift: number): TemaRender {
  const {ascendant, mc} = fictionalAngles(shift);
  const planets: Record<string,unknown> = Object.fromEntries(
    fictionalPlanetPositions(shift).map(({name, longitude}, i) => [name, {
      longitude,
      latitude: i % 2 ? -0.75 : 0.75,
      longitudeSpeed: 0.2,
      latitudeSpeed: 0.02,
      equatoriale: {declination: i * 2.2 - 11},
    }]),
  );
  return Object.assign(new TemaRender(), {
    dataora:'2001-02-03T04:05:00Z',
    as:ascendant, ds:(ascendant+180)%360, mc, ic:(mc+180)%360,
    planets,
    houses:{egizia:{
      ascendant, mc, vertex:(ascendant+120)%360,
      house:fictionalHousePositions(shift).map(house => house.longitude),
    }},
    australInversion:false, fasiSinodiche:{},fasiSinodicheLatitudinali:{},
    lunazioniErmetiche:{},astrologiaOraria:{},orePlanetarie:{},partiArabe:{}
  });
}
export function fictionalPlanets(shift = 0): ReadonlyArray<{name:DemoPlanet; longitude:number}> {
  return fictionalPlanetPositions(shift);
}
export function fictionalHouses(shift = 0): ReadonlyArray<{number:number; longitude:number}> {
  return fictionalHousePositions(shift);
}
