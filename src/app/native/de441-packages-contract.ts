export type PackageRequest = {action:'status'|'cancel'} | {action:'plan'; firstYear:number; lastYear:number} | {action:'start'; firstYear:number; lastYear:number; planned:string[]; plannedBytes:number} | {action:'remove'; id:string};
export type Package = {id:string; firstYear:number; lastYear:number; bytes:number; required:boolean; installed:boolean};
export type PackageReply = {status:string; busy:boolean; current:string|null; downloaded:number; total:number; outcome:string|null; packages:Package[]; planned:string[]; plannedBytes:number; freeBytes:number|null};
export interface PackagePort {invoke(command:'de441_packages', args:{request:PackageRequest}):Promise<unknown>;}
const token = (v:unknown):v is string => typeof v==='string' && /^[a-zA-Z0-9._-]{1,100}$/.test(v);
const uint = (v:unknown):v is number => Number.isSafeInteger(v) && (v as number)>=0;
export async function packageRequest(port:PackagePort, request:PackageRequest):Promise<PackageReply> {
  const fallback:PackageReply={status:'unavailable',busy:false,current:null,downloaded:0,total:0,outcome:null,packages:[],planned:[],plannedBytes:0,freeBytes:null};
  if ((request.action==='plan'||request.action==='start') && (!Number.isInteger(request.firstYear)||!Number.isInteger(request.lastYear)||request.firstYear>request.lastYear||request.firstYear < -20000||request.lastYear > 19998)) return fallback;
  if (request.action==='remove' && !token(request.id)) return fallback;
  if (request.action==='start' && (!Array.isArray(request.planned)||request.planned.length>256||!request.planned.every(token)||!uint(request.plannedBytes))) return fallback;
  try {
    const value=await port.invoke('de441_packages',{request});
    if (!value || typeof value!=='object' || Array.isArray(value)) return fallback;
    const r=value as Record<string,unknown>;
    if (!token(r['status'])||typeof r['busy']!=='boolean'||!(r['current']===null||token(r['current']))||!uint(r['downloaded'])||!uint(r['total'])||!(r['outcome']===null||token(r['outcome']))||!uint(r['plannedBytes'])||!(r['freeBytes']===null||uint(r['freeBytes']))||!Array.isArray(r['planned'])||r['planned'].length>256||!r['planned'].every(token)||!Array.isArray(r['packages'])||r['packages'].length>256) return fallback;
    const packages:Package[]=[];
    for(const p of r['packages']) {
      if(!p||typeof p!=='object'||Array.isArray(p))return fallback;
      const x=p as Record<string,unknown>;
      if(!token(x['id'])||!Number.isInteger(x['firstYear'])||!Number.isInteger(x['lastYear'])||!uint(x['bytes'])||typeof x['required']!=='boolean'||typeof x['installed']!=='boolean') return fallback;
      packages.push(x as Package);
    }
    return {status:r['status'],busy:r['busy'],current:r['current'],downloaded:r['downloaded'],total:r['total'],outcome:r['outcome'],packages,planned:r['planned'],plannedBytes:r['plannedBytes'],freeBytes:r['freeBytes']};
  } catch {return fallback;}
}
