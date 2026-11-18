import { LEGACY_THEBAN_MONOMERS } from './legacy-theban-monomers';

/** The first mode reproduces the screenshot's displayed 0–29 degree labels,
 * but makes no claim about Angelini's continuous-longitude procedure. */
export type MonomericDegreeMode = 'shown-degree' | 'costeseque-1940';

export interface MonomerSymbol {
  readonly sourcePointIndex: number;
  readonly signIndex: number;
  readonly sourceLabel: number;
  readonly sourceText: string;
}

export interface MonomerResolution {
  readonly mode: MonomericDegreeMode;
  readonly primary: MonomerSymbol;
  /** The source's Costesèque convention also activates the adjacent points. */
  readonly adjacent: readonly MonomerSymbol[];
}

const WHOLE_ZODIAC = 360;

function symbolAt(index: number): MonomerSymbol {
  const sourcePointIndex = ((index % WHOLE_ZODIAC) + WHOLE_ZODIAC) % WHOLE_ZODIAC;
  return {
    sourcePointIndex,
    signIndex: Math.floor(sourcePointIndex / 30),
    sourceLabel: sourcePointIndex % 30,
    sourceText: LEGACY_THEBAN_MONOMERS[sourcePointIndex],
  };
}

/**
 * Resolve an explicitly selected convention against the source-labelled table.
 * Costesèque 1940 is a point-and-adjacency method, not nearest integer alone:
 * 00′–30′ belongs to the lower point; 31′–59′ to the upper point. This
 * implementation works at *displayed whole-minute precision*: seconds are
 * discarded before the threshold, never secretly rounded.
 *
 * The Serto table has strong lineage compatibility with the nomenclature,
 * but the Costesèque procedure is not attributed to Angelini by this code.
 */
export function resolveMonomers(longitudeDeg: number, mode: MonomericDegreeMode): MonomerResolution {
  if (!Number.isFinite(longitudeDeg) || (mode !== 'shown-degree' && mode !== 'costeseque-1940')) {
    throw new RangeError('A finite zodiac longitude and explicit degree mode are required');
  }
  if (LEGACY_THEBAN_MONOMERS.length !== WHOLE_ZODIAC) {
    throw new Error('The historical catalog must have exactly 360 source labels');
  }
  const normalized = ((longitudeDeg % WHOLE_ZODIAC) + WHOLE_ZODIAC) % WHOLE_ZODIAC;
  const lowerPoint = Math.floor(normalized);
  const displayedMinute = Math.floor((normalized - lowerPoint) * 60 + 1e-8);
  const primaryPoint = mode === 'costeseque-1940' && displayedMinute > 30
    ? (lowerPoint + 1) % WHOLE_ZODIAC : lowerPoint;
  return {
    mode,
    primary: symbolAt(primaryPoint),
    adjacent: mode === 'costeseque-1940'
      ? [symbolAt(primaryPoint - 1), symbolAt(primaryPoint + 1)] : [],
  };
}

export const MONOMER_SIGN_NAMES = {
  it: ['Ariete','Toro','Gemelli','Cancro','Leone','Vergine','Bilancia','Scorpione','Sagittario','Capricorno','Acquario','Pesci'],
  en: ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'],
} as const;

export function monomerPointLabel(symbol: MonomerSymbol, locale: 'it' | 'en'): string {
  return `${MONOMER_SIGN_NAMES[locale][symbol.signIndex]} ${symbol.sourceLabel}°`;
}
