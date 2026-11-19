import {invoke, isTauri} from '@tauri-apps/api/core';
import {packageRequest, type PackageRequest, type PackageReply} from './de441-packages-contract';
export function packagesAvailable():boolean {return isTauri();}
export function requestPackages(request:PackageRequest):Promise<PackageReply> {
  return packageRequest({invoke:(command,args)=>invoke<unknown>(command,args)},request);
}
