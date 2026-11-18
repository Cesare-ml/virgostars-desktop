import {invoke, isTauri} from '@tauri-apps/api/core';
import {requestHistoricalPlanet, type HistoricalRequest, type HistoricalResult} from './historical-planets-contract';

/** Isolated developer-facing adapter; not used by the civil-time chart flow. */
export function calculateHistoricalPlanet(request: HistoricalRequest): Promise<HistoricalResult> {
  return requestHistoricalPlanet({isNative: isTauri, invoke: (command, args) => invoke<unknown>(command, args)}, request);
}
