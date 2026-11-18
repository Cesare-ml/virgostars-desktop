import {Channel, invoke, isTauri} from '@tauri-apps/api/core';
import {updateRequest, type UpdateChannel, type UpdateProgress, type UpdateReply} from './update-contract';
export function updateAvailable():boolean {return isTauri();}
export async function requestUpdate(action:'check'|'install', channel:UpdateChannel, version?:string, onProgress?:(p:UpdateProgress)=>void):Promise<UpdateReply> {
  const progress = new Channel<UpdateProgress>();
  progress.onmessage = value => {if (value && Number.isSafeInteger(value.downloaded) && value.downloaded>=0 && (value.total===null || Number.isSafeInteger(value.total) && value.total>0)) onProgress?.(value);};
  return updateRequest({invoke:(command,args)=>invoke<unknown>(command,args)},action,channel,version,progress);
}
