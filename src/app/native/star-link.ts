import {invoke, isTauri} from '@tauri-apps/api/core';
import {requestStarPage} from './star-link-contract';

export function inNativeDesktop(): boolean { return isTauri(); }
export function openStarPage(id:number): Promise<boolean> {
  return requestStarPage({isNative:isTauri, invoke:(command,args)=>invoke<unknown>(command,args)}, id);
}
