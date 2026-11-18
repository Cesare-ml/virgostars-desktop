/** Account-scoped chart synchronization. Credentials never cross this IPC. */
export type SyncedChart = Readonly<{
  id:string; name:string; civilDate:string; civilTime:string|null; timeUnknown:boolean; timeZone:string|null;
  latMicro:number|null; lngMicro:number|null; placeName:string; groups:readonly string[];
  syncStatus:'clean'|'pending'|'conflict'|'missing'; sourceUpdatedAtMs:number;
}>;
export type SyncOperation = Readonly<{operation:'sync'|'list';attemptId:string}> |
  Readonly<{operation:'set_groups';attemptId:string;chartId:string;baseGroups:readonly string[];groups:readonly string[]}> |
  Readonly<{operation:'associate';attemptId:string;chartId:string;localChartId:string;localUpdatedAtMs:number;sourceUpdatedAtMs:number;baseGroups:readonly string[];groups:readonly string[]}> |
  Readonly<{operation:'queue_create';attemptId:string;chartId:string;localUpdatedAtMs:number;localDate:string;localTime:string;baseGroups:readonly string[]}> |
  Readonly<{operation:'cancel_rejected';attemptId:string;chartId:string}> |
  Readonly<{operation:'offline_list'}> |
  Readonly<{operation:'offline_set_groups';chartId:string;baseGroups:readonly string[];groups:readonly string[]}>;
export type SyncResult = Readonly<{kind:'list';charts:readonly SyncedChart[];pendingChartIds:readonly string[];rejectedChartIds:readonly string[]}> |
  Readonly<{kind:'sync';imported:number;updated:number;alreadyLinked:number;uploaded:number;conflicts:number}> |
  Readonly<{kind:'saved'|'stale'|'disabled'|'unavailable'}>;
export interface SyncTransport {
  isNative():boolean;
  invoke(command:'desktop_chart_sync_v1',args:{request:Record<string,unknown>}):Promise<unknown>;
}
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ATTEMPT=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UNSAFE=/[\p{Cc}\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u;
const ZONE=/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;
function object(x:unknown):x is Record<string,unknown> {
  return typeof x==='object' && x!==null && !Array.isArray(x) && (Object.getPrototypeOf(x)===Object.prototype || Object.getPrototypeOf(x)===null);
}
function prop(o:object,k:string):unknown {
  const d=Object.getOwnPropertyDescriptor(o,k);
  if (!d || !d.enumerable || !Object.hasOwn(d,'value')) throw new Error('Invalid sync response');
  return d.value;
}
function keys(o:object,expected:readonly string[]):boolean {
  const actual=Reflect.ownKeys(o);
  return actual.length===expected.length && actual.every(k=>typeof k==='string' && expected.includes(k));
}
function label(x:unknown,max:number,required:boolean):x is string {
  return typeof x==='string' && [...x].length<=max && (!required || !!x.trim()) && !UNSAFE.test(x);
}
function groups(x:unknown):readonly string[] {
  if (!Array.isArray(x) || Object.getPrototypeOf(x)!==Array.prototype || x.length>50 || Reflect.ownKeys(x).length!==x.length+1) throw new Error('Invalid groups');
  const result:string[]=[];
  for(let i=0;i<x.length;i++) {
    const v=prop(x,String(i));
    if (!label(v,160,true) || v.trim()!==v || result.includes(v)) throw new Error('Invalid groups');
    result.push(v);
  }
  return Object.freeze(result);
}
function date(x:unknown):x is string {
  if (typeof x!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const y=Number(x.slice(0,4)),m=Number(x.slice(5,7)),d=Number(x.slice(8,10));
  if (y<1 || m<1 || m>12 || d<1) return false;
  const leap=y%4===0 && (y%100!==0 || y%400===0);
  return d <= [31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1];
}
function clock(x:unknown):x is string {
  if (typeof x!=='string' || !/^\d{2}:\d{2}:\d{2}$/.test(x)) return false;
  return Number(x.slice(0,2))<=23 && Number(x.slice(3,5))<=59 && Number(x.slice(6,8))<=59;
}
function micro(x:unknown,max:number):x is number {return typeof x==='number' && Number.isSafeInteger(x) && Math.abs(x)<=max;}
function chart(raw:unknown):SyncedChart {
  if (!object(raw) || !keys(raw,['id','name','civilDate','civilTime','timeUnknown','timeZone','latMicro','lngMicro','placeName','groups','syncStatus','sourceUpdatedAtMs'])) throw new Error('Invalid chart');
  const id=prop(raw,'id'),name=prop(raw,'name'),civilDate=prop(raw,'civilDate'),civilTime=prop(raw,'civilTime');
  const timeUnknown=prop(raw,'timeUnknown'),timeZone=prop(raw,'timeZone'),latMicro=prop(raw,'latMicro'),lngMicro=prop(raw,'lngMicro');
  const placeName=prop(raw,'placeName'),syncStatus=prop(raw,'syncStatus'),sourceUpdatedAtMs=prop(raw,'sourceUpdatedAtMs');
  if (typeof id!=='string' || !ID.test(id) || !label(name,255,true) || !date(civilDate) || typeof timeUnknown!=='boolean' ||
      !(timeUnknown ? civilTime===null : clock(civilTime)) ||
      !(timeZone===null || (typeof timeZone==='string' && timeZone.length<=120 && ZONE.test(timeZone))) ||
      !((latMicro===null && lngMicro===null) || (micro(latMicro,90_000_000) && micro(lngMicro,180_000_000))) ||
      !label(placeName,160,false) || typeof sourceUpdatedAtMs!=='number' || !Number.isSafeInteger(sourceUpdatedAtMs) || sourceUpdatedAtMs<0 || (syncStatus!=='clean' && syncStatus!=='pending' && syncStatus!=='conflict' && syncStatus!=='missing')) throw new Error('Invalid chart');
  return Object.freeze({id,name,civilDate,civilTime:civilTime as string|null,timeUnknown,timeZone:timeZone as string|null,
    latMicro:latMicro as number|null,lngMicro:lngMicro as number|null,placeName,groups:groups(prop(raw,'groups')),syncStatus,sourceUpdatedAtMs});
}
export async function requestChartSync(port:SyncTransport, operation:SyncOperation):Promise<SyncResult> {
  try {
    if (!port.isNative()) return {kind:'unavailable'};
    const offline=operation.operation==='offline_list' || operation.operation==='offline_set_groups';
    if (!offline && (!('attemptId' in operation) || typeof operation.attemptId!=='string' || !ATTEMPT.test(operation.attemptId))) return {kind:'unavailable'};
    let request:Record<string,unknown>={protocolVersion:1,operation:operation.operation};
    if ('attemptId' in operation) request={...request,attemptId:operation.attemptId};
    if (operation.operation==='cancel_rejected') {
      if (!ID.test(operation.chartId)) return {kind:'unavailable'};
      request={...request,chartId:operation.chartId};
    } else if (operation.operation==='queue_create') {
      if (!ID.test(operation.chartId) || !Number.isSafeInteger(operation.localUpdatedAtMs) || operation.localUpdatedAtMs<0 || !date(operation.localDate) || !clock(operation.localTime)) return {kind:'unavailable'};
      request={...request,chartId:operation.chartId,localUpdatedAtMs:operation.localUpdatedAtMs,localDate:operation.localDate,localTime:operation.localTime,baseGroups:groups(operation.baseGroups)};
    } else if (operation.operation==='set_groups' || operation.operation==='offline_set_groups' || operation.operation==='associate') {
      if (!ID.test(operation.chartId)) return {kind:'unavailable'};
      request={...request,chartId:operation.chartId,baseGroups:groups(operation.baseGroups),groups:groups(operation.groups)};
      if (operation.operation==='associate') {
        if (!ID.test(operation.localChartId) || operation.localChartId===operation.chartId || !Number.isSafeInteger(operation.localUpdatedAtMs) || operation.localUpdatedAtMs<0 || !Number.isSafeInteger(operation.sourceUpdatedAtMs) || operation.sourceUpdatedAtMs<0) return {kind:'unavailable'};
        request={...request,localChartId:operation.localChartId,localUpdatedAtMs:operation.localUpdatedAtMs,sourceUpdatedAtMs:operation.sourceUpdatedAtMs};
      }
    } else if (operation.operation!=='list' && operation.operation!=='sync' && operation.operation!=='offline_list') return {kind:'unavailable'};
    const raw=await port.invoke('desktop_chart_sync_v1',{request});
    if (!object(raw) || prop(raw,'protocolVersion')!==1) throw new Error('Invalid response');
    const status=prop(raw,'status');
    if (status==='disabled' && keys(raw,['protocolVersion','status'])) return {kind:'disabled'};
    if ((operation.operation==='set_groups' || operation.operation==='offline_set_groups' || operation.operation==='associate' || operation.operation==='queue_create' || operation.operation==='cancel_rejected') && status==='stale' && keys(raw,['protocolVersion','status'])) return {kind:'stale'};
    if (status!=='ok') throw new Error('Invalid response');
    if ((operation.operation==='set_groups' || operation.operation==='offline_set_groups' || operation.operation==='associate' || operation.operation==='queue_create' || operation.operation==='cancel_rejected') && keys(raw,['protocolVersion','status'])) return {kind:'saved'};
    if ((operation.operation==='list' || operation.operation==='offline_list') && keys(raw,['protocolVersion','status','charts','pendingChartIds','rejectedChartIds'])) {
      const values=prop(raw,'charts');
      if (!Array.isArray(values) || Object.getPrototypeOf(values)!==Array.prototype || values.length>5000 || Reflect.ownKeys(values).length!==values.length+1) throw new Error('Invalid response');
      const charts=Array.from({length:values.length},(_,i)=>chart(prop(values,String(i))));
      if (new Set(charts.map(c=>c.id)).size!==charts.length) throw new Error('Duplicate chart');
      const ids=prop(raw,'pendingChartIds');
      if (!Array.isArray(ids) || Object.getPrototypeOf(ids)!==Array.prototype || ids.length>5000 || Reflect.ownKeys(ids).length!==ids.length+1) throw new Error('Invalid response');
      const pendingChartIds=Array.from({length:ids.length},(_,i)=>prop(ids,String(i)));
      if (pendingChartIds.some(id=>typeof id!=='string' || !ID.test(id)) || new Set(pendingChartIds).size!==pendingChartIds.length) throw new Error('Invalid pending IDs');
      const rejected=prop(raw,'rejectedChartIds');
      if (!Array.isArray(rejected) || Object.getPrototypeOf(rejected)!==Array.prototype || rejected.length>5000 || Reflect.ownKeys(rejected).length!==rejected.length+1) throw new Error('Invalid response');
      const rejectedChartIds=Array.from({length:rejected.length},(_,i)=>prop(rejected,String(i)));
      if (rejectedChartIds.some(id=>typeof id!=='string' || !ID.test(id) || pendingChartIds.includes(id)) || new Set(rejectedChartIds).size!==rejectedChartIds.length) throw new Error('Invalid rejected IDs');
      return {kind:'list',charts:Object.freeze(charts),pendingChartIds:Object.freeze(pendingChartIds as string[]),rejectedChartIds:Object.freeze(rejectedChartIds as string[])};
    }
    if (operation.operation==='sync' && keys(raw,['protocolVersion','status','summary'])) {
      const s=prop(raw,'summary');
      if (!object(s) || !keys(s,['imported','updated','alreadyLinked','uploaded','conflicts'])) throw new Error('Invalid summary');
      const values=['imported','updated','alreadyLinked','uploaded','conflicts'].map(k=>prop(s,k));
      if (!values.every(v=>typeof v==='number' && Number.isSafeInteger(v) && v>=0 && v<=10000)) throw new Error('Invalid summary');
      return {kind:'sync',imported:values[0] as number,updated:values[1] as number,alreadyLinked:values[2] as number,uploaded:values[3] as number,conflicts:values[4] as number};
    }
  } catch { /* Fail closed without exposing native errors. */ }
  return {kind:'unavailable'};
}
