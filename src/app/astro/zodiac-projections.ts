import {normalize360, signedAngularDistance} from 'astrological-functions';
import type {TemaRenderData} from './tema-render-data';

export type ZodiacProjectionMode = 'dodecatemoria' | 'antiscia' | 'contra-antiscia';
export type ZodiacProjectionAxis = 'Cardinale' | 'Fissa' | 'Mutevole';
export const TRADITIONAL_POINTS = ['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn'] as const;
const AXIS_LONGITUDES: Record<ZodiacProjectionAxis, number> = {Cardinale:270, Fissa:300, Mutevole:330};
export type ZodiacProjectionPoint = Readonly<{
  name:string; longitude:number; antiscia:number; contraAntiscia:number; retrograde:boolean;
}>;

/** Regolo's reflection axes, using the shared angular-distance primitive. */
export function zodiacProjectionPoints(data:TemaRenderData, axis:ZodiacProjectionAxis,
  visible:Readonly<Record<string, {shown:boolean} | undefined>>): ZodiacProjectionPoint[] {
  const anchor = AXIS_LONGITUDES[axis];
  return TRADITIONAL_POINTS.flatMap(name => {
    const body = data.planets[name];
    if (!body || !visible[name]?.shown || !Number.isFinite(body.longitude)) return [];
    const antiscia = normalize360(anchor + signedAngularDistance(body.longitude, anchor));
    return [{name, longitude:body.longitude, antiscia, contraAntiscia:normalize360(antiscia + 180), retrograde:body.longitudeSpeed < 0}];
  });
}
