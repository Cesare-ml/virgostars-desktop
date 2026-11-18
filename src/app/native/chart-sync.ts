import {invoke, isTauri} from '@tauri-apps/api/core';
import {requestChartSync, type SyncOperation, type SyncResult} from './chart-sync-contract';

export function chartSync(operation: SyncOperation): Promise<SyncResult> {
  return requestChartSync({isNative:isTauri,invoke:(command,args)=>invoke<unknown>(command,args)},operation);
}
