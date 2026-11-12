import {invoke, isTauri} from '@tauri-apps/api/core';
import {SyntheticCalculationTransport} from './synthetic-calculation-transport';

/** Developer-only synthetic CPU/IPC probe, never a source of chart positions. */
export const nativeSyntheticCalculationProbe = new SyntheticCalculationTransport({
  isNative: isTauri,
  invoke: (command, args) => invoke<unknown>(command, args),
});
