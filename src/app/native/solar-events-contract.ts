/**
 * Read-only, versioned native handshake for future Rust solar events.
 * An `ok` fixture is accepted only after strict copying and the independent
 * solar-hour/domain consistency checks. The shipped native command currently
 * returns `provider_unavailable`, never calculated events.
 */
import type { SolarEventAdapterInput } from 'astrological-functions/planetary-hours-solar-adapter';
import { resolveEphemerisPlanetaryHour, type NatalSolarContext, type EphemerisPlanetaryHourResult } from '../astro/ephemeris-planetary-hour';
import { validChartRequest } from './chart-calculation-contract';

export type AutomaticHourResult =
  | Extract<EphemerisPlanetaryHourResult, {status:'READY'}> & Readonly<{kind:'ready'}>
  | Readonly<{kind:'not_native'|'provider_unavailable'|'invalid_request'|'out_of_range'|'calculation_failed'|'unavailable'|'invalid_source'|'mismatched_observer'|'weekday_mismatch'|'outside_interval'}>;

export interface SolarEventsTransport {
  isNative(): boolean;
  invoke(command:'calculate_solar_events', args:{request:{protocolVersion:1;utcIso:string;latMicro:number;lngMicro:number}}):Promise<unknown>;
  timers?: {set(callback:()=>void,delayMs:number):unknown;clear(handle:unknown):void};
}

const ERROR = 'Invalid solar events native contract';
const DEADLINE_MS = 5_000;
const TIMED_OUT = Symbol('solar event command deadline');
function record(value:unknown, keys:readonly string[]):Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
      Object.keys(value).length !== keys.length || !keys.every(key=>Object.hasOwn(value,key)) ||
      Object.keys(value).some(key=>!keys.includes(key))) throw new Error(ERROR);
  const values:Record<string,unknown> = {};
  for (const key of keys) {
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if (!descriptor || !Object.hasOwn(descriptor,'value') || !descriptor.enumerable) throw new Error(ERROR);
    values[key]=descriptor.value;
  }
  return values;
}
function bounded(value:unknown):string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error(ERROR);
  return value;
}
function iso(value:unknown):string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) throw new Error(ERROR);
  return value;
}
function finite(value:unknown):number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(ERROR);
  return value;
}

/** Explicit whitelist prevents an unreviewed native field from entering Angular. */
function copySnapshot(raw:unknown):SolarEventAdapterInput {
  const fields=record(raw,['weekday','observer','model','source','events']);
  const observer=record(fields.observer,['latitudeDeg','longitudeDegEast','elevationMeters']);
  const model=record(fields.model,['horizonDefinitionId','refractionModelId','eventAlgorithmId']);
  const source=record(fields.source,['engineId','engineVersion','kernelSetId','timeModelId','evidence']);
  const variant=record(fields.events, Object.keys(recordEventKeys(fields.events)));
  const events=variant.availability==='AVAILABLE'
    ? {availability:'AVAILABLE' as const,sunriseUtc:iso(variant.sunriseUtc),sunsetUtc:iso(variant.sunsetUtc),nextSunriseUtc:iso(variant.nextSunriseUtc)}
    : {availability:'UNAVAILABLE' as const,reason:variant.reason as 'POLAR_DAY'|'POLAR_NIGHT'|'SUN_EVENTS_UNAVAILABLE'};
  if (!['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'].includes(fields.weekday as string) ||
      source.engineId!=='VIRGOSTARS_EPHEMERIS' || source.evidence!=='CALLER_ASSERTED_NOT_VERIFIED' ||
      (variant.availability==='UNAVAILABLE' && !['POLAR_DAY','POLAR_NIGHT','SUN_EVENTS_UNAVAILABLE'].includes(variant.reason as string))) throw new Error(ERROR);
  return {
    weekday:fields.weekday as SolarEventAdapterInput['weekday'],
    observer:{latitudeDeg:finite(observer.latitudeDeg),longitudeDegEast:finite(observer.longitudeDegEast),elevationMeters:finite(observer.elevationMeters)},
    model:{horizonDefinitionId:bounded(model.horizonDefinitionId),refractionModelId:bounded(model.refractionModelId),eventAlgorithmId:bounded(model.eventAlgorithmId)},
    source:{engineId:'VIRGOSTARS_EPHEMERIS',engineVersion:bounded(source.engineVersion),kernelSetId:bounded(source.kernelSetId),timeModelId:bounded(source.timeModelId),evidence:'CALLER_ASSERTED_NOT_VERIFIED'},
    events,
  };
}

function recordEventKeys(raw:unknown):Record<string,unknown> {
  if (raw===null || typeof raw!=='object' || Array.isArray(raw)) throw new Error(ERROR);
  const availability=Object.getOwnPropertyDescriptor(raw,'availability');
  if (!availability || !Object.hasOwn(availability,'value')) throw new Error(ERROR);
  if (availability.value==='AVAILABLE') return {availability:null,sunriseUtc:null,sunsetUtc:null,nextSunriseUtc:null};
  if (availability.value==='UNAVAILABLE') return {availability:null,reason:null};
  throw new Error(ERROR);
}

export async function requestAutomaticHour(transport:SolarEventsTransport, chart:NatalSolarContext):Promise<AutomaticHourResult> {
  if (!chart || !validChartRequest(chart) || typeof chart.timeZone !== 'string') return {kind:'invalid_request'};
  try {
    if (!transport.isNative()) return {kind:'not_native'};
    const timers=transport.timers??{set:(callback:()=>void,ms:number)=>setTimeout(callback,ms),clear:(handle:unknown)=>clearTimeout(handle as ReturnType<typeof setTimeout>)};
    let timeOut!:()=>void;
    let expired=false;
    const deadline=new Promise<typeof TIMED_OUT>(resolve=>{timeOut=()=>{expired=true;resolve(TIMED_OUT);};});
    // Register the deadline before queueing any native call. Even a throwing or
    // synchronously firing scheduler must not dispatch an unbounded IPC.
    let timerHandle:unknown;
    try {timerHandle=timers.set(timeOut,DEADLINE_MS);} catch {return {kind:'unavailable'};}
    if (expired) {try {timers.clear(timerHandle);} catch {/* already unavailable */} return {kind:'unavailable'};}
    let raw:unknown;
    try {
      raw=await Promise.race([
        Promise.resolve().then(()=>transport.invoke('calculate_solar_events',{
          request:{protocolVersion:1,utcIso:chart.utcIso,latMicro:chart.latMicro,lngMicro:chart.lngMicro},
        })),
        deadline,
      ]);
    } finally {try {timers.clear(timerHandle);} catch {/* never report native details */}}
    if (raw===TIMED_OUT) return {kind:'unavailable'};
    const envelope=record(raw,['protocolVersion','status','snapshot']);
    if (envelope.protocolVersion!==1) throw new Error(ERROR);
    if (['provider_unavailable','invalid_request','out_of_range','calculation_failed'].includes(envelope.status as string) && envelope.snapshot===null) {
      return {kind:envelope.status as 'provider_unavailable'|'invalid_request'|'out_of_range'|'calculation_failed'};
    }
    if (envelope.status!=='ok') throw new Error(ERROR);
    const result=resolveEphemerisPlanetaryHour(chart,copySnapshot(envelope.snapshot));
    switch (result.status) {
      case 'READY': return {kind:'ready',...result};
      case 'MISMATCHED_OBSERVER': return {kind:'mismatched_observer'};
      case 'WEEKDAY_MISMATCH': return {kind:'weekday_mismatch'};
      case 'OUTSIDE_INTERVAL': return {kind:'outside_interval'};
      case 'UNAVAILABLE': return {kind:'unavailable'};
      default: return {kind:'invalid_source'};
    }
  } catch { return {kind:'unavailable'}; }
}
