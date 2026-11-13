import { TemaRender } from 'grafici-astrologici';
import { buildFictionalAngles } from './fictional-geometry';

// Original, deliberately fictional test data. Never label these as astronomical ephemerides
// or use them for real birth chart interpretation.
export const DEMO_NAMES = ['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto'] as const;
export type DemoPlanet = typeof DEMO_NAMES[number];

export function makeFictionalTheme(shift: number): TemaRender {
  const angles = buildFictionalAngles(shift);
  const planets: Record<string,unknown> = Object.fromEntries(DEMO_NAMES.map((name,i) => [name,{
    longitude: angles.planetLongitudes[i],
    latitude: i%2 ? -0.75 : 0.75,
    longitudeSpeed: 0.2,
    latitudeSpeed: 0.02,
    equatoriale: { declination: i*2.2-11 },
  }]));
  return Object.assign(new TemaRender(), {
    dataora:'2001-02-03T04:05:00Z',
    as:angles.ascendant, ds:angles.descendant, mc:angles.mediumCoeli, ic:angles.imumCoeli,
    planets,
    houses:{ egizia: {
      ascendant:angles.ascendant, mc:angles.mediumCoeli, vertex:angles.vertex,
      house:angles.houseCusps,
    } },
    australInversion:false, fasiSinodiche:{},fasiSinodicheLatitudinali:{},
    lunazioniErmetiche:{},astrologiaOraria:{},orePlanetarie:{},partiArabe:{}
  });
}
export function fictionalPlanets(): ReadonlyArray<{name:DemoPlanet; longitude:number}> {
  const angles = buildFictionalAngles(0);
  return DEMO_NAMES.map((name,index)=>({name,longitude:angles.planetLongitudes[index]}));
}
export function fictionalHouses(): ReadonlyArray<{number:number; longitude:number}> {
  const angles = buildFictionalAngles(0);
  return angles.houseCusps.map((longitude,index)=>({number:index+1,longitude}));
}
