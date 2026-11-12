import {invoke, isTauri} from '@tauri-apps/api/core';
import {createNativeCalculationPort} from './calculation-port';
import {validCalculationDraft} from './calculation-queue';

/** The opt-in native transport, NOT connected to the live chart yet. */
export const nativeCalculationProbePort = createNativeCalculationPort({
  isNative: isTauri,
  invoke: (command, args) => invoke<unknown>(command, args),
}, validCalculationDraft);
