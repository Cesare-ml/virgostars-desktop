import {invoke, isTauri} from '@tauri-apps/api/core';
import {requestConflicts, type ConflictOperation, type ConflictResult} from './group-conflicts-contract';

export function groupConflicts(operation: ConflictOperation): Promise<ConflictResult> {
  return requestConflicts({isNative:isTauri,invoke:(command,args)=>invoke<unknown>(command,args)},operation);
}
