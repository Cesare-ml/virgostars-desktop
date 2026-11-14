import {invoke, isTauri} from '@tauri-apps/api/core';
import {OfflinePlaceSearch} from './offline-places-contract';

/**
 * App-local adapter. No remote API, coordinates telemetry, privileged path
 * parameters, or database shipping to the WebView.
 */
/** Each city picker owns its own latest-request generation and cancellation scope. */
export function createOfflinePlaceSearch(): OfflinePlaceSearch {
  return new OfflinePlaceSearch({
    isNative: isTauri,
    invoke: (command, args) => invoke<unknown>(command, args),
  });
}

/** @deprecated For compatibility only. UI components must use a scoped instance. */
export const offlinePlaceSearch = createOfflinePlaceSearch();
