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
}>;
export type SkyDomeData = Readonly<{
  providerId: string;
  planets: readonly SkyDomePoint[];
  stars: readonly SkyDomePoint[];
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
  if(!Array.isArray(v)||v.length>max||!Object.keys(v).every(k=>/^\d+$/.test(k)))throw Error('Invalid sky dome protocol');
  return v;
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
  if(new Set(planets.map(p=>p.id)).size!==planets.length||
    !planets.some(p=>p.id==='Sun')||!planets.some(p=>p.id==='Moon')||
    new Set(stars.map(s=>s.id)).size!==stars.length) throw Error('Invalid sky dome protocol');
  return Object.freeze({kind:'ready',data:Object.freeze({
    providerId:raw['providerId'],
    planets:Object.freeze(planets),stars:Object.freeze(stars),
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
