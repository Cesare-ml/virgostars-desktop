import { TemaRender } from 'grafici-astrologici';

// Original, deliberately fictional test data. Never label these as astronomical ephemerides
// or use them for real birth chart interpretation.
export const DEMO_NAMES = ['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto'] as const;
export type DemoPlanet = typeof DEMO_NAMES[number];
const degrees = [19.3, 83.1, 44.8, 129.4, 167.1, 208.6, 278.1, 305.6, 347.7, 6.5] as const;

export function makeFictionalTheme(shift: number): TemaRender {
  const ascendant = (103 + shift) % 360;
  const mc = (15 + shift) % 360;
  const planets: Record<string,unknown> = Object.fromEntries(DEMO_NAMES.map((name,i) => [name,{
    longitude: (degrees[i] + shift) % 360,
    latitude: i%2 ? -0.75 : 0.75,
    longitudeSpeed: 0.2,
    latitudeSpeed: 0.02,
    equatoriale: { declination: i*2.2-11 },
  }]));
  return Object.assign(new TemaRender(), {
    dataora:'2001-02-03T04:05:00Z',
    as:ascendant, ds:(ascendant+180)%360, mc, ic:(mc+180)%360,
    planets,
    houses:{ egizia: {
      ascendant, mc, vertex:(ascendant+120)%360,
      house:Array.from({length:12},(_,i)=>(ascendant+i*30)%360),
    } },
    australInversion:false, fasiSinodiche:{},fasiSinodicheLatitudinali:{},
    lunazioniErmetiche:{},astrologiaOraria:{},orePlanetarie:{},partiArabe:{}
  });
}
export function fictionalPlanets(): ReadonlyArray<{name:DemoPlanet; longitude:number}> {
  return DEMO_NAMES.map((name,index)=>({name,longitude:degrees[index]}));
}
export function fictionalHouses(): ReadonlyArray<{number:number; longitude:number}> {
  return Array.from({length:12},(_,i)=>({number:i+1,longitude:(103+i*30)%360}));
}
