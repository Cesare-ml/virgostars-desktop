const PRINCIPAL=new Set(['Tyche','Basis','Daimon','Ananke']);
export type KleroiFilter='all'|'principal'|'planetary';
export function isKlerosSelected(name:string,filter:KleroiFilter):boolean {
  return filter==='all' || (filter==='principal')===PRINCIPAL.has(name);
}
/** Enable aspect endpoints only for the lots actually supplied to the wheel. */
export function enableKleroiAspects(points:Record<string,{aspVerso:boolean}>,lots:Readonly<Record<string,number>>,filter:KleroiFilter):void {
  for (const name of Object.keys(lots)) if (points[name] && isKlerosSelected(name,filter)) points[name].aspVerso=true;
}
