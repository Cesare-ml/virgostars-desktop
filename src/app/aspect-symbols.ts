/**
 * Written symbols for the aspects, so the aspect lists read as point, aspect, point
 * without naming anything; the name appears when the pointer rests on the symbol.
 */
export const ASPECT_SYMBOLS: Readonly<Record<string, string>> = Object.freeze({
  congiunzione: '☌', opposizione: '☍', trigono: '△', quadrato: '□', sestile: '⚹',
  quinconce: '⚻', semisestile: '⚺', semiquadrato: '∠',
  quintile: 'Q', biquintile: 'bQ', semiquintile: 'Q/2', novile: 'N', settile: 'Sp',
  phisolare: 'Φ☉', philunare: 'Φ☽',
  parallelodideclinazione: '∥', antiparallelo: '∦',
});

export function aspectSymbol(id: string): string {
  return ASPECT_SYMBOLS[id] ?? id;
}
