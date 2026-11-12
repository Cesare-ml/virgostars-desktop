import {invoke, isTauri} from '@tauri-apps/api/core';
import {OfflinePlaceSearch} from './offline-places-contract';

/**
 * App-local adapter. No remote API, coordinates telemetry, privileged path
 * parameters, or database shipping to the WebView.
 */
export const offlinePlaceSearch = new OfflinePlaceSearch({
  isNative: isTauri,
  invoke: (command, args) => invoke<unknown>(command, args),
});
