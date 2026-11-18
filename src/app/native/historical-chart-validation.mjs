/** Shared input checks for historical chart calculation and archive storage. */
const plain = x => typeof x === 'object' && x !== null && !Array.isArray(x) &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const source = x => typeof x === 'string' && x.trim().length > 0 && new TextEncoder().encode(x).length <= 200 && !/[\x00-\x1f\x7f]/.test(x);
const nonnegative = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
export function validHistoricalChartRequest(r) {
  if (!plain(r) || !plain(r.civil) || !plain(r.civil.offset) || !plain(r.deltaT)) return false;
  const c = r.civil, o = c.offset, d = r.deltaT;
  const leap = c.year % 4 === 0 && (c.calendar === 'julian' || c.year % 100 !== 0 || c.year % 400 === 0);
  const days = [0,31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
  return Number.isInteger(c.year) && c.year >= -12999 && c.year <= 3999 &&
    Number.isInteger(c.month) && c.month >= 1 && c.month <= 12 && Number.isInteger(c.day) && c.day >= 1 && c.day <= days[c.month] &&
    Number.isInteger(c.hour) && c.hour >= 0 && c.hour < 24 && Number.isInteger(c.minute) && c.minute >= 0 && c.minute < 60 &&
    Number.isFinite(c.second) && c.second >= 0 && c.second < 60 && ['gregorian','julian'].includes(c.calendar) &&
    nonnegative(c.uncertaintySeconds) && Number.isSafeInteger(r.latMicro) && Math.abs(r.latMicro) <= 90_000_000 &&
    Number.isSafeInteger(r.lngMicro) && Math.abs(r.lngMicro) <= 180_000_000 &&
    (o.kind === 'localMeanSolar' || (o.kind === 'supplied' && Number.isFinite(o.secondsEast) && Math.abs(o.secondsEast) <= 86400 && source(o.source))) &&
    nonnegative(d.uncertaintySeconds) && (d.kind === 'espenakMeeus2006' || (d.kind === 'supplied' && Number.isFinite(d.seconds) && source(d.source)));
}

/** Copy only own data properties; never retain mutable native/IPC objects. */
export function copyHistoricalChartRequest(value) {
  try {
    const read = (obj, key) => {
      if (!plain(obj)) throw new Error();
      const d = Object.getOwnPropertyDescriptor(obj,key);
      if (!d || !d.enumerable || !Object.hasOwn(d,'value')) throw new Error();
      return d.value;
    };
    const c=read(value,'civil'), d=read(value,'deltaT'), o=read(c,'offset');
    const offsetKind=read(o,'kind'), deltaKind=read(d,'kind');
    const offset=offsetKind === 'localMeanSolar' ? {kind:offsetKind} :
      {kind:offsetKind, secondsEast:read(o,'secondsEast'), source:read(o,'source')};
    const deltaT=deltaKind === 'espenakMeeus2006' ? {kind:deltaKind,uncertaintySeconds:read(d,'uncertaintySeconds')} :
      {kind:deltaKind,seconds:read(d,'seconds'),uncertaintySeconds:read(d,'uncertaintySeconds'),source:read(d,'source')};
    const civil={year:read(c,'year'),month:read(c,'month'),day:read(c,'day'),hour:read(c,'hour'),minute:read(c,'minute'),
      second:read(c,'second'),calendar:read(c,'calendar'),offset:Object.freeze(offset),uncertaintySeconds:read(c,'uncertaintySeconds')};
    const result={civil:Object.freeze(civil),deltaT:Object.freeze(deltaT),latMicro:read(value,'latMicro'),lngMicro:read(value,'lngMicro')};
    if (!validHistoricalChartRequest(result)) return null;
    return Object.freeze(result);
  } catch { return null; }
}
