/** Fixed updater commands; arbitrary native commands are never accepted from UI data. */
export type UpdateChannel = 'stable'|'beta';
export type UpdateStatus = 'available'|'current'|'not_configured'|'check_failed'|'signature_invalid'|'download_failed'|'package_too_large'|'install_failed'|'invalid_release'|'stale'|'busy'|'unavailable'|'install_started'|'invalid_channel'|'backup_failed';
export type UpdateReply = {status:UpdateStatus; currentVersion:string; version:string|null; notes:string|null};
export type UpdateProgress = {downloaded:number; total:number|null};
export interface UpdatePort { invoke(command:'check_updates'|'install_update', args:Record<string,unknown>):Promise<unknown>; }
const statuses = new Set<UpdateStatus>(['available','current','not_configured','check_failed','signature_invalid','download_failed','package_too_large','install_failed','invalid_release','stale','busy','unavailable','install_started','invalid_channel','backup_failed']);
export async function updateRequest(port:UpdatePort, action:'check'|'install', channel:UpdateChannel, version?:string, progress?:unknown):Promise<UpdateReply> {
  const fallback:UpdateReply = {status:action==='check'?'check_failed':'install_failed',currentVersion:'',version:null,notes:null};
  if ((channel!=='stable' && channel!=='beta') || (action==='install' && (typeof version!=='string' || !/^[0-9A-Za-z.+-]{1,80}$/.test(version)))) return fallback;
  try {
    const command = action==='check' ? 'check_updates' : 'install_update';
    const value = await port.invoke(command, action==='check'?{channel}:{channel,version,progress});
    if (!value || typeof value!=='object' || Array.isArray(value)) return fallback;
    const r=value as Record<string,unknown>;
    if (!statuses.has(r['status'] as UpdateStatus) || typeof r['currentVersion']!=='string' || r['currentVersion'].length>80 ||
      !(r['version']===null || typeof r['version']==='string' && r['version'].length<=80) ||
      !(r['notes']===null || typeof r['notes']==='string' && r['notes'].length<=4000)) return fallback;
    return {status:r['status'] as UpdateStatus,currentVersion:r['currentVersion'],version:r['version'] as string|null,notes:r['notes'] as string|null};
  } catch {return fallback;}
}
