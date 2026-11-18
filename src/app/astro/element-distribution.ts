/**
 * A read-only element summary of the chart already on screen. This view never
 * estimates planetary positions or recomputes the dodecatemoria: both arrive
 * from the validated chart / astrological-functions adapter.
 */
import { locateLongitudeInHouses } from 'astrological-functions';
import type { HouseSystemId } from '../native/chart-calculation-contract';
import type { TemaRenderData } from './tema-render-data';

export const ELEMENT_ORDER = ['fire', 'air', 'water', 'earth'] as const;
export type ElementId = typeof ELEMENT_ORDER[number];

const ZODIAC_ELEMENTS: readonly ElementId[] = [
  'fire', 'earth', 'air', 'water', 'fire', 'earth',
  'air', 'water', 'fire', 'earth', 'air', 'water',
];
const SEVEN = [
  ['Sun', '☉'], ['Moon', '☽'], ['Mercury', '☿'], ['Venus', '♀'],
  ['Mars', '♂'], ['Jupiter', '♃'], ['Saturn', '♄'],
] as const;

export const MODALITY_ORDER = ['cardinal','fixed','mutable'] as const;
export type ModalityId = typeof MODALITY_ORDER[number];

export type ElementPlacement = Readonly<{
  name: string;
  glyph: string;
  longitude: number;
  sign: number;
  house: number | null;
  retrograde: boolean;
}>;
export type ModalityGroup = Readonly<{
  id: ModalityId;
  planets: readonly ElementPlacement[];
}>;
export type ElementStrip = Readonly<{
  id: ElementId;
  housePlanets: readonly ElementPlacement[];
  signPlanets: readonly ElementPlacement[];
  houseDodecatemoria: readonly ElementPlacement[];
  signDodecatemoria: readonly ElementPlacement[];
}>;
export type ElementDistribution = Readonly<{
  ascSign: number;
  dsSign: number;
  ascElement: ElementId;
  dsElement: ElementId;
  strips: readonly ElementStrip[];
  modalities: readonly ModalityGroup[];
  countedPlanets: number;
}>;

function zodiacSign(longitude: number): number {
  return Math.floor((((longitude % 360) + 360) % 360) / 30);
}

/** In a polar region or unavailable house system, leave houses empty. */
function findHouse(longitude: number, cusps: readonly number[] | undefined): number | null {
  if (!cusps) return null;
  try { return locateLongitudeInHouses(longitude, [...cusps]).house; }
  catch { return null; }
}

/** The caller supplies the existing houseDisplay convention; no duplicate house classification. */
export function elementDistribution(
  data: TemaRenderData, system: HouseSystemId, elementOfHouse: (house:number) => ElementId | null,
): ElementDistribution {
  const cusps = data.houses[system]?.house;
  const strips = ELEMENT_ORDER.map(id => ({
    id, housePlanets: [] as ElementPlacement[], signPlanets: [] as ElementPlacement[],
    houseDodecatemoria: [] as ElementPlacement[], signDodecatemoria: [] as ElementPlacement[],
  }));
  const modalities = MODALITY_ORDER.map(id => ({id, planets: [] as ElementPlacement[]}));
  let countedPlanets = 0;
  for (const [name, glyph] of SEVEN) {
    const body = data.planets[name];
    if (!body || !Number.isFinite(body.longitude)) continue;
    countedPlanets++;
    const sign = zodiacSign(body.longitude);
    const house = findHouse(body.longitude, cusps);
    const placement = Object.freeze({name, glyph, longitude:body.longitude, sign, house, retrograde:body.longitudeSpeed<0});
    modalities[sign % 3].planets.push(placement);
    strips.find(row => row.id === ZODIAC_ELEMENTS[sign])?.signPlanets.push(placement);
    const houseId = house === null ? null : elementOfHouse(house);
    if (houseId) strips.find(row => row.id === houseId)?.housePlanets.push(placement);

    const dodLongitude = body.dodecatemoria?.longitude;
    if (dodLongitude === undefined || !Number.isFinite(dodLongitude)) continue;
    const longitude = dodLongitude;
    const dodSign = zodiacSign(longitude);
    const dodHouse = findHouse(longitude, cusps);
    const dod = Object.freeze({name, glyph, longitude, sign:dodSign, house:dodHouse, retrograde:body.longitudeSpeed<0});
    strips.find(row => row.id === ZODIAC_ELEMENTS[dodSign])?.signDodecatemoria.push(dod);
    const dodHouseId = dodHouse === null ? null : elementOfHouse(dodHouse);
    if (dodHouseId) strips.find(row => row.id === dodHouseId)?.houseDodecatemoria.push(dod);
  }
  const ascSign = zodiacSign(data.as);
  const dsSign = zodiacSign(data.ds);
  return {
    ascSign, dsSign, ascElement:ZODIAC_ELEMENTS[ascSign], dsElement:ZODIAC_ELEMENTS[dsSign],
    strips, modalities, countedPlanets,
  };
}
