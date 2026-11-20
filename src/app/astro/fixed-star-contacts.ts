import {calculateVirgoStarsStarContacts} from 'astrological-functions/virgostars-star-contacts';
import type {FixedStarV1} from '../native/chart-calculation-contract';
import type {RenderHouseSystem} from './tema-render-data';
import type {FixedStarSettings} from '../chart-settings';
import type {TemaRenderData} from './tema-render-data';

/** Convert native south-through-west azimuth to north-through-east. */
export function starAzimuthNorthEast(azimuthSouthWestDeg: number): number {
  return (azimuthSouthWestDeg + 180) % 360;
}

/** A missing magnitude is handled separately and is never treated as zero. */
export function starWithinMagnitude(star: Pick<FixedStarV1, 'magnitude'>, settings: FixedStarSettings): boolean {
  return star.magnitude === null ? settings.includeUnknownMagnitude :
    settings.magnitudeLimit === null || star.magnitude <= settings.magnitudeLimit;
}

/** Interpret the native south-through-west azimuth with the contact rule's axis labels. */
export function fixedStarContact(star: FixedStarV1, points: Readonly<Record<string,number>>,
  house: Pick<RenderHouseSystem, 'ascendant'|'ds'|'mc'|'ic'> | null,
  settings: Pick<FixedStarSettings, 'longitudeOrb'|'axisOrb'> = {longitudeOrb:1, axisOrb:1}):
  {star:FixedStarV1; conjunctions:readonly string[]; axis:string | null; longitude:number} | null {
  // Native IPC uses Swiss-style south through west (S=0, W=90, N=180).
  // The contact rule labels the eastern half as AS and the western half as DS,
  // so it needs north through east (N=0, E=90, S=180, W=270).
  const northEastAzimuth = starAzimuthNorthEast(star.azimuthSouthWestDeg);
  const coordinates = {longitudeDeg:star.longitudeDeg, trueAltitudeDeg:star.trueAltitudeDeg, azimuthDeg:northEastAzimuth};
  const conjunctions = settings.longitudeOrb > 0 ? calculateVirgoStarsStarContacts({...coordinates, points, orbDeg:settings.longitudeOrb}).conjunctions : [];
  const axis = house && settings.axisOrb > 0 ? calculateVirgoStarsStarContacts({...coordinates, points:{}, orbDeg:settings.axisOrb}).axis : null;
  if (!axis && !conjunctions.length) return null;
  const axes = house ? {AS:house.ascendant, DS:house.ds, MC:house.mc, IC:house.ic} : null;
  return {star, conjunctions, axis, longitude:axis && axes ? axes[axis] : star.longitudeDeg};
}

/** Use only the calculated, visible projections actually selected on the wheel. */
export function dodecatemoriaContactPoints(data:TemaRenderData,
  visible:Readonly<Record<string,{shown:boolean}|undefined>>, selected:string): Record<string,number> {
  const points:Record<string,number> = {};
  for (const [name, body] of Object.entries(data.planets)) {
    const longitude = body.dodecatemoria?.longitude;
    if (visible[name]?.shown && (selected === 'tutti' || selected === name) &&
        typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= 0 && longitude < 360) points[name] = longitude;
  }
  return points;
}

/** Fixed stars keep their physical longitude; projected bodies add longitude contacts. */
export function fixedStarChartContact(star:FixedStarV1, natal:Readonly<Record<string,number>>,
  projected:Readonly<Record<string,number>>, house:Pick<RenderHouseSystem,'ascendant'|'ds'|'mc'|'ic'>|null,
  settings:Pick<FixedStarSettings,'longitudeOrb'|'axisOrb'>):
  {star:FixedStarV1; conjunctions:readonly string[]; dodecatemoriaConjunctions:readonly string[]; axis:string|null; longitude:number}|null {
  const original = fixedStarContact(star,natal,house,settings);
  const projection = settings.longitudeOrb > 0 && Object.keys(projected).length
    ? fixedStarContact(star,projected,house,{longitudeOrb:settings.longitudeOrb,axisOrb:0}) : null;
  if (!original && !projection) return null;
  return {star,conjunctions:original?.conjunctions ?? [], dodecatemoriaConjunctions:projection?.conjunctions ?? [],
    axis:original?.axis ?? null,longitude:original?.longitude ?? star.longitudeDeg};
}
