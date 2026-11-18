import { invoke, isTauri } from '@tauri-apps/api/core';
import {requestAutomaticHour, type AutomaticHourResult} from './solar-events-contract';
import type {NatalSolarContext} from '../astro/ephemeris-planetary-hour';

/** One local, read-only request: no network, archive access or user record. */
export function calculateAutomaticHour(chart:NatalSolarContext):Promise<AutomaticHourResult> {
  return requestAutomaticHour({
    isNative:isTauri,
    invoke:(command,args)=>invoke<unknown>(command,args),
  },chart);
}
