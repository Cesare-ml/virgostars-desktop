/** Pure visual presentation helpers. Never calculate or invent celestial positions. */
export type SkyLight = 'night'|'twilight'|'day';

/**
 * An illustrative gradient, NOT an atmospheric or photometric simulation.
 * The input comes only from the native-computed apparent Sun altitude.
 */
export function skyLightFromSun(altitudeDeg:number|null):SkyLight {
  if(altitudeDeg===null || !Number.isFinite(altitudeDeg))return 'night';
  if(altitudeDeg>=0)return 'day';
  return altitudeDeg>=-12?'twilight':'night';
}

export type StarAppearance = Readonly<{bin:0|1|2|3;sizePx:number;opacity:number}>;

/** A display-only magnitude scale. Unknown magnitudes receive a faint marker. */
export function starAppearance(magnitude:number|null):StarAppearance {
  const mag=(magnitude===null||!Number.isFinite(magnitude))?5:magnitude;
  const bin:0|1|2|3=mag<1?0:mag<2.5?1:mag<4.5?2:3;
  const values=[
    {bin:0 as const,sizePx:16,opacity:0.96},
    {bin:1 as const,sizePx:12,opacity:0.85},
    {bin:2 as const,sizePx:9,opacity:0.74},
    {bin:3 as const,sizePx:6,opacity:0.62},
  ];
  return values[bin];
}

/** A stable, visual-only palette; it does NOT assert spectral classifications. */
export function planetAccent(id:string):string {
  switch(id){
    case 'Sun':return '#ffcb79';
    case 'Moon':return '#e4eafa';
    case 'Mercury':return '#b7cce9';
    case 'Venus':return '#f6d9b1';
    case 'Mars':return '#f7a98f';
    case 'Jupiter':return '#d7c9ff';
    case 'Saturn':return '#ddd3b9';
    case 'Uranus':return '#a9e5e1';
    case 'Neptune':return '#9cb7f5';
    case 'Pluto':return '#dac6e5';
    case 'Chiron':return '#bfd6ce';
    default:return '#d5dbea';
  }
}
