import {invoke, isTauri} from '@tauri-apps/api/core';
import {requestHistoricalCalendar, type HistoricalCalendarRequest} from './historical-calendar-contract';
import type {HistoricalResult} from './historical-planets-contract';

export function calculateHistoricalCalendar(request: HistoricalCalendarRequest): Promise<HistoricalResult> {
  return requestHistoricalCalendar({isNative: isTauri, invoke: (command, args) => invoke<unknown>(command, args)}, request);
}
