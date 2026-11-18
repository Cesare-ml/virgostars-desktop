import {MONOMERI} from './monomeri-data';
import type {TemaRenderData} from './astro/tema-render-data';
import type {HouseSystemId} from './native/chart-calculation-contract';

export interface MonomeroView { name: string; degree: number; sign: number; text: string; }
export const monomeriAvailable = MONOMERI.length === 360;

/** Regolo indexes the 360 entries by truncated, absolute zodiac longitude. */
export function monomeroFor(name: string, longitude: number, corpus: readonly string[] = MONOMERI): MonomeroView | null {
  if (!name || !Number.isFinite(longitude) || longitude < 0 || longitude >= 360 || corpus.length !== 360) return null;
  const index = Math.floor(longitude);
  const text = corpus[index];
  if (!text) return null;
  return {name, degree: index % 30, sign: Math.floor(index / 30), text};
}

/** Leaving a glyph keeps the selection; an invalid hit cannot erase it. */
export function monomeroOnHover(current: MonomeroView | null,
  hover: {name: string; longitude: number} | null, corpus: readonly string[] = MONOMERI): MonomeroView | null {
  return hover ? monomeroFor(hover.name, hover.longitude, corpus) ?? current : current;
}

/** Re-resolve the selection after a chart redraw, without retaining a stale degree. */
export function monomeroForChart(name: string, data: TemaRenderData, system: HouseSystemId,
  corpus: readonly string[] = MONOMERI): MonomeroView | null {
  const house = data.houses[system];
  const axes: Readonly<Record<string, number | undefined>> = {
    AS:house?.ascendant, DS:house?.ds, MC:house?.mc, IC:house?.ic,
  };
  const longitude = Object.prototype.hasOwnProperty.call(axes, name) ? axes[name] : data.planets[name]?.longitude;
  return typeof longitude === 'number' ? monomeroFor(name, longitude, corpus) : null;
}
