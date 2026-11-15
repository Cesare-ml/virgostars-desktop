import {invoke, isTauri} from '@tauri-apps/api/core';
import {requestArchive, type ArchiveOperation, type ArchiveResult} from './chart-archive-contract';

/**
 * App-local adapter for the on-device chart archive. No remote API, no file
 * path and no account data: the Rust host owns the storage location.
 */
export function chartArchive(operation: ArchiveOperation): Promise<ArchiveResult> {
  return requestArchive({
    isNative: isTauri,
    invoke: (command, args) => invoke<unknown>(command, args),
  }, operation);
}
