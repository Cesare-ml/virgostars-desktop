import {invoke, isTauri} from '@tauri-apps/api/core';
import {requestSkyDome, type SkyDomeRequest, type SkyDomeResult} from './sky-dome-contract';

/** A single audited, read-only native call. Never use a remote sky API. */
export function calculateSkyDome(request:SkyDomeRequest):Promise<SkyDomeResult> {
  return requestSkyDome({
    isNative:isTauri,
    invoke:(command,args)=>invoke<unknown>(command,args),
  },request);
}
