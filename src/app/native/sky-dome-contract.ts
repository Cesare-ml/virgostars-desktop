/**
 * Observer-sky protocol v1. The Rust host computes topocentric geometric
 * altitude and azimuth; Three.js ONLY turns these angles into vectors.
 */
export type SkyDomePoint = Readonly<{
  id: string;
  altitudeDeg: number;
  /** True North=0°, East=90°, South=180°, West=270°. */
  azimuthNorthEastDeg: number;
  magnitude: number | null;
  approximate: boolean;
  eclipticLongitudeDeg:number|null;
  eclipticLatitudeDeg:number|null;
  rightAscensionDeg:number|null;
  declinationDeg:number|null;
  distanceAu:number|null;
  longitudeSpeedDegPerDay:number|null;
  constellation:string|null;
  catalogId:number|null;
  ephemerisSource:string|null;
}>;
/** Geometric point on the observer's celestial sphere (not a body). */
export type SkyDomeDirection = Readonly<{
  altitudeDeg:number;
  azimuthNorthEastDeg:number;
}>;
/** One 30-degree tropical sign segment, projected by the native ephemeris. */
export type SkyZodiacSegment = Readonly<{
  signIndex:number;
  points:readonly SkyDomeDirection[];
  label:SkyDomeDirection;
}>;
/** Ecliptic band +/-8° latitude with real host-calculated sky directions. */
export type SkyZodiacGrid = Readonly<{
  northEdge:readonly SkyDomeDirection[];
  southEdge:readonly SkyDomeDirection[];
  signDividers:readonly (readonly SkyDomeDirection[])[];
  decadeTicks:readonly (readonly SkyDomeDirection[])[];
}>;
export type SkyAngleId = 'ASC'|'DSC'|'MC'|'IC';
export type SkyAngle = Readonly<{
  id:SkyAngleId;
  zodiacLongitudeDeg:number;
  position:SkyDomeDirection;
}>;
/** Cusp ticks in the +/-8 degree ecliptic band; NOT full mundane house planes. */
export type SkyHouseGrid = Readonly<{
  id:string;
  cuspLongitudesDeg:readonly number[];
  separators:readonly (readonly SkyDomeDirection[])[];
  labels:readonly SkyDomeDirection[];
}>;
export type SkyDomeData = Readonly<{
  providerId: string;
  planets: readonly SkyDomePoint[];
  stars: readonly SkyDomePoint[];
  zodiacSegments: readonly SkyZodiacSegment[];
  zodiacGrid: SkyZodiacGrid;
  angles: readonly SkyAngle[];
  houseGrids: readonly SkyHouseGrid[];
}>;
export type SkyDomeResult =
  | Readonly<{kind:'ready'; data:SkyDomeData}>
  | Readonly<{kind:'not_native'|'provider_unavailable'|'invalid_request'|'out_of_range'|'calculation_failed'|'unavailable'}>;
export type SkyDomeRequest = Readonly<{utcIso:string;latMicro:number;lngMicro:number}>;
export interface SkyDomeTransport {
  isNative():boolean;
  invoke(command:'calculate_sky_dome',args:{request:{
    protocolVersion:1;utcIso:string;latMicro:number;lngMicro:number;
  }}):Promise<unknown>;
}
const PLANETS = new Set(['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto','Chiron']);
const FAILURES = new Set(['provider_unavailable','invalid_request','out_of_range','calculation_failed']);
function record(v:unknown): v is Record<string,unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
}
function num(v:unknown,min:number,max:number):number {
  if(typeof v !== 'number'|| !Number.isFinite(v)||v<min||v>max)throw Error('Invalid sky dome protocol');
  return v;
}
function arr(v:unknown,max:number):unknown[] {
  if(!Array.isArray(v)||v.length>max||Object.keys(v).length!==v.length||!Object.keys(v).every(k=>/^\d+$/.test(k)))throw Error('Invalid sky dome protocol');
  return v;
}
function direction(v:unknown):SkyDomeDirection {
  if(!record(v))throw Error('Invalid sky dome protocol');
  return Object.freeze({
    altitudeDeg:num(v['altitudeDeg'],-90,90),
    azimuthNorthEastDeg:num(v['azimuthNorthEastDeg'],0,360),
  });
}
function zodiac(v:unknown):readonly SkyZodiacSegment[] {
  const segments=arr(v,12);
  if(segments.length!==12)throw Error('Invalid sky dome protocol');
  return Object.freeze(segments.map((segment,i)=>{
    if(!record(segment)||segment['signIndex']!==i)throw Error('Invalid sky dome protocol');
    const positions=arr(segment['points'],31);
    if(positions.length!==31)throw Error('Invalid sky dome protocol');
    return Object.freeze({
      signIndex:i,
      points:Object.freeze(positions.map(direction)),
      label:direction(segment['label']),
    });
  }));
}
function zodiacGrid(v:unknown):SkyZodiacGrid {
  if(!record(v))throw Error('Invalid sky dome protocol');
  const line=(raw:unknown,length:number):readonly SkyDomeDirection[]=>{
    const source=arr(raw,length);
    if(source.length!==length)throw Error('Invalid sky dome protocol');
    return Object.freeze(source.map(direction));
  };
  const lines=(raw:unknown,count:number,points:number):readonly (readonly SkyDomeDirection[])[]=>{
    const source=arr(raw,count);
    if(source.length!==count)throw Error('Invalid sky dome protocol');
    return Object.freeze(source.map(item=>line(item,points)));
  };
  return Object.freeze({
    northEdge:line(v['northEdge'],361),
    southEdge:line(v['southEdge'],361),
    signDividers:lines(v['signDividers'],12,9),
    decadeTicks:lines(v['decadeTicks'],24,5),
  });
}
function angles(v:unknown):readonly SkyAngle[] {
  const result=arr(v,4);
  const names:readonly SkyAngleId[]=['ASC','DSC','MC','IC'];
  if(result.length!==4)throw Error('Invalid sky dome protocol');
  return Object.freeze(result.map((item,i)=>{
    if(!record(item)||item['id']!==names[i])
      throw Error('Invalid sky dome protocol');
    return Object.freeze({
      id:names[i],
      zodiacLongitudeDeg:num(item['zodiacLongitudeDeg'],0,360),
      position:direction(item['position']),
    });
  }));
}
const HOUSE_SYSTEMS=new Set(['egizia','porfirio','regio-montano','koch','placido']);
function houseGrids(v:unknown):readonly SkyHouseGrid[] {
  const list=arr(v,5),ids=new Set<string>();
  return Object.freeze(list.map(item=>{
    if(!record(item)||typeof item['id']!=='string'||!HOUSE_SYSTEMS.has(item['id'])||ids.has(item['id']))
      throw Error('Invalid sky dome protocol');
    const id=item['id'];ids.add(id);
    const cusps=arr(item['cuspLongitudesDeg'],12);
    const separators=arr(item['separators'],12);
    const labels=arr(item['labels'],12);
    if(cusps.length!==12||separators.length!==12||labels.length!==12)
      throw Error('Invalid sky dome protocol');
    return Object.freeze({
      id,
      cuspLongitudesDeg:Object.freeze(cusps.map(x=>num(x,0,360))),
      separators:Object.freeze(separators.map(raw=>{
        const points=arr(raw,9);
        if(points.length!==9)throw Error('Invalid sky dome protocol');
        return Object.freeze(points.map(direction));
      })),
      labels:Object.freeze(labels.map(direction)),
    });
  }));
}
function optionalNum(v:Record<string,unknown>,key:string,min:number,max:number):number|null {
  const value=v[key];return value===undefined||value===null?null:num(value,min,max);
}
function optionalString(v:Record<string,unknown>,key:string,limit=80):string|null {
  const value=v[key];
  if(value===undefined||value===null)return null;
  if(typeof value!=='string'||value.length===0||value.length>limit||
    /[\u0000-\u001f]/.test(value))throw Error('Invalid sky dome protocol');
  return value;
}
function point(v:unknown,star:boolean):SkyDomePoint {
  if(!record(v)||typeof v['id']!=='string'||v['id'].length<1||v['id'].length>80||
    (star ? /[\u0000-\u001f]/.test(v['id']) : !PLANETS.has(v['id'])) ||
    typeof v['approximate']!=='boolean' ||
    (!star&&v['magnitude']!==null) )throw Error('Invalid sky dome protocol');
  return Object.freeze({
    id:v['id'],
    altitudeDeg:num(v['altitudeDeg'],-90,90),
    azimuthNorthEastDeg:num(v['azimuthNorthEastDeg'],0,360),
    magnitude:v['magnitude']===null?null:num(v['magnitude'],-30,30),
    approximate:v['approximate'],
    eclipticLongitudeDeg:optionalNum(v,'eclipticLongitudeDeg',0,360),
    eclipticLatitudeDeg:optionalNum(v,'eclipticLatitudeDeg',-90,90),
    rightAscensionDeg:optionalNum(v,'rightAscensionDeg',0,360),
    declinationDeg:optionalNum(v,'declinationDeg',-90,90),
    distanceAu:optionalNum(v,'distanceAu',0,10000),
    longitudeSpeedDegPerDay:optionalNum(v,'longitudeSpeedDegPerDay',-360,360),
    constellation:optionalString(v,'constellation',48),
    catalogId:optionalNum(v,'catalogId',1,10000000),
    ephemerisSource:optionalString(v,'ephemerisSource',80),
  });
}
export function decodeSkyDome(raw:unknown):SkyDomeResult {
  if(!record(raw)||raw['protocolVersion']!==1)throw Error('Invalid sky dome protocol');
  if(typeof raw['status']==='string'&&FAILURES.has(raw['status']))
    return Object.freeze({kind:raw['status'] as 'provider_unavailable'|'invalid_request'|'out_of_range'|'calculation_failed'});
  if(raw['status']!=='ok'||typeof raw['providerId']!=='string'||
    !/^[a-z][a-z0-9_]{0,39}$/.test(raw['providerId']))throw Error('Invalid sky dome protocol');
  const planets=arr(raw['planets'],11).map(p=>point(p,false));
  const stars=arr(raw['stars'],2048).map(s=>point(s,true));
  const zodiacSegments=zodiac(raw['zodiacSegments']);
  const grid=zodiacGrid(raw['zodiacGrid']);
  const anglePoints=angles(raw['angles']);
  const housePoints=houseGrids(raw['houseGrids']??[]);
  if(new Set(planets.map(p=>p.id)).size!==planets.length||
    !planets.some(p=>p.id==='Sun')||!planets.some(p=>p.id==='Moon')) throw Error('Invalid sky dome protocol');
  return Object.freeze({kind:'ready',data:Object.freeze({
    providerId:raw['providerId'],
    planets:Object.freeze(planets),stars:Object.freeze(stars),zodiacSegments,zodiacGrid:grid,angles:anglePoints,houseGrids:housePoints,
  })});
}
export async function requestSkyDome(transport:SkyDomeTransport,request:SkyDomeRequest):Promise<SkyDomeResult> {
  if(!transport.isNative())return {kind:'not_native'};
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(request.utcIso) ||
    !Number.isSafeInteger(request.latMicro)||Math.abs(request.latMicro)>90_000_000||
    !Number.isSafeInteger(request.lngMicro)||Math.abs(request.lngMicro)>180_000_000) return {kind:'invalid_request'};
  try {
    return decodeSkyDome(await transport.invoke('calculate_sky_dome',{request:{
      protocolVersion:1,utcIso:request.utcIso,latMicro:request.latMicro,lngMicro:request.lngMicro,
    }}));
  }catch {return {kind:'unavailable'};}
}
