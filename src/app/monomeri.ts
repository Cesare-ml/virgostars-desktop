import {MONOMERI} from './monomeri-data';

const PLANETS: Readonly<Record<string, string>> = {
  Sun:'☉', Moon:'☽', Mercury:'☿', Venus:'♀', Mars:'♂', Jupiter:'♃', Saturn:'♄',
  Uranus:'♅', Neptune:'♆', Pluto:'♇',
};
const SIGNS = ['♈︎','♉︎','♊︎','♋︎','♌︎','♍︎','♎︎','♏︎','♐︎','♑︎','♒︎','♓︎'];
export interface MonomeroView { planet: string; degree: number; sign: string; text: string; }
export const monomeriAvailable = MONOMERI.length === 360;

/** Regolo indexes the 360 entries by truncated, absolute zodiac longitude. */
export function monomeroFor(name: string, longitude: number, corpus: readonly string[] = MONOMERI): MonomeroView | null {
  if (!Object.hasOwn(PLANETS, name) || !Number.isFinite(longitude) || longitude < 0 || longitude >= 360 || corpus.length !== 360) return null;
  const index = Math.floor(longitude);
  const text = corpus[index];
  if (!text) return null;
  return {planet: PLANETS[name], degree: index % 30, sign: SIGNS[Math.floor(index / 30)], text};
}
