import {invoke, isTauri} from '@tauri-apps/api/core';
import {requestReturns, type ReturnRequestV1, type ReturnSearchResult} from './return-search-contract';

/**
 * App-local adapter for the solar and lunar return search. The request holds a
 * longitude and a year; no name, birth date, file path or account data.
 */
export function findReturns(request: ReturnRequestV1): Promise<ReturnSearchResult> {
  return requestReturns({
    isNative: isTauri,
    invoke: (command, args) => invoke<unknown>(command, args),
  }, request);
}
