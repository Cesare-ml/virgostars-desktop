import type {Package} from './native/de441-packages-contract';

/** Years are astronomical internally; each choice expands to one catalog edge. */
export type CoverageTimeline = Readonly<{
  firstChoices: readonly number[];
  lastChoices: readonly number[];
  installedFirst: number;
  installedLast: number;
  earliestRemovable: Package | null;
  latestRemovable: Package | null;
}>;

export function coverageTimeline(packages: readonly Package[]): CoverageTimeline | null {
  if (!packages.length || packages.length > 256) return null;
  const ordered = [...packages].sort((a,b)=>a.firstYear-b.firstYear);
  if (ordered.some((p,i)=>!Number.isInteger(p.firstYear) || !Number.isInteger(p.lastYear) ||
      p.firstYear > p.lastYear || (i > 0 && ordered[i-1].lastYear+1 !== p.firstYear))) return null;
  const first=ordered.findIndex(p=>p.installed);
  let last=ordered.length-1;
  while(last>=0 && !ordered[last].installed) last--;
  if (first<0 || ordered.slice(first,last+1).some(p=>!p.installed) ||
      ordered.some(p=>p.required&&!p.installed)) return null;
  const installedFirst=ordered[first].firstYear, installedLast=ordered[last].lastYear;
  return {
    firstChoices:[...ordered.slice(0,first).map(p=>p.firstYear),installedFirst],
    lastChoices:[installedLast,...ordered.slice(last+1).map(p=>p.lastYear)],
    installedFirst,installedLast,
    earliestRemovable:ordered[first].required?null:ordered[first],
    latestRemovable:ordered[last].required?null:ordered[last],
  };
}

export function yearLabel(year:number, locale:'it'|'en'): string {
  if (year <= 0) return `${1-year} ${locale==='it'?'a.C.':'BCE'}`;
  return `${year} ${locale==='it'?'d.C.':'CE'}`;
}
