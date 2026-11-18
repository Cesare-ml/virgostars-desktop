import type {SynodRecord} from './native/synod-events-contract';

/** The website's usual order; any additional recorded bodies remain accessible by name. */
const GLYPH_ORDER: readonly string[] = ['Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto','true Node','true Node Sud','Sun'];

export function hasSynodGlyph(name:string): boolean { return GLYPH_ORDER.includes(name); }

export function orderSynodRecords(records:readonly SynodRecord[]): SynodRecord[] {
  const rank = (name:string): number => {
    const index = GLYPH_ORDER.indexOf(name);
    return index < 0 ? GLYPH_ORDER.length : index;
  };
  return [...records].sort((a,b) => rank(a.body) - rank(b.body) || a.body.localeCompare(b.body));
}
