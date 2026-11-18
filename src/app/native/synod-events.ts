import {invoke, isTauri} from '@tauri-apps/api/core';
import {requestSynods, type SynodResult} from './synod-events-contract';

export function synodEvents(utcMs:number): Promise<SynodResult> {
  return requestSynods({isNative:isTauri, invoke:(command,args) => invoke<unknown>(command,args)}, utcMs);
}
