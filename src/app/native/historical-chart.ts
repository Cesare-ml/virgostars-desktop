import {invoke, isTauri} from '@tauri-apps/api/core';
import {requestHistoricalChart, type HistoricalChartRequest, type HistoricalChartResult} from './historical-chart-contract';
import {decodeChartResponse} from './chart-calculation-contract';

export function calculateHistoricalChart(request:HistoricalChartRequest, includeFixedStars = false):Promise<HistoricalChartResult> {
  return requestHistoricalChart({isNative:isTauri, invoke:(command,args) => invoke<unknown>(command,args)}, request, decodeChartResponse, includeFixedStars);
}
