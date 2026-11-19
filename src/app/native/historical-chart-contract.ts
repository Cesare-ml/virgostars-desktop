import type {ChartProviderV1, ChartSnapshotV1} from './chart-calculation-contract';
import {copyHistoricalChartRequest} from './historical-chart-validation.mjs';
export {validHistoricalChartRequest} from './historical-chart-validation.mjs';

export type HistoricalOffset = Readonly<{kind:'localMeanSolar'}> |
  Readonly<{kind:'supplied'; secondsEast:number; source:string}>;
export type HistoricalDeltaT = Readonly<{kind:'espenakMeeus2006'; uncertaintySeconds:number}> |
  Readonly<{kind:'supplied'; seconds:number; uncertaintySeconds:number; source:string}>;
export type HistoricalCivil = Readonly<{year:number; month:number; day:number; hour:number; minute:number;
  second:number; calendar:'gregorian'|'julian'; offset:HistoricalOffset; uncertaintySeconds:number}>;
export type HistoricalChartRequest = Readonly<{civil:HistoricalCivil; deltaT:HistoricalDeltaT; latMicro:number; lngMicro:number}>;
export type HistoricalChartTime = Readonly<{jdUt1:number; jdTt:number; deltaTSeconds:number;
  deltaTUncertaintySeconds:number; deltaTSource:string; civilUncertaintySeconds:number;
  offsetSecondsEast:number; offsetSource:string}>;
export type HistoricalChartResult = Readonly<{kind:'ready'; chart:ChartSnapshotV1; provider:ChartProviderV1; time:HistoricalChartTime}> |
  Readonly<{kind:'invalid_request'|'provider_unavailable'|'time_source_out_of_range'|'ephemeris_out_of_range'|'calculation_failed'|'not_native'|'unavailable'}>;
export interface HistoricalChartTransport {
  isNative():boolean;
  invoke(command:'calculate_historical_chart', args:{request: HistoricalChartRequest & {protocolVersion:1}}):Promise<unknown>;
}
const plain = (x:unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x) &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const source = (x:unknown): x is string => typeof x === 'string' && x.trim().length > 0 &&
  new TextEncoder().encode(x).length <= 200 && !/[\x00-\x1f\x7f]/.test(x);
const nonnegative = (x:unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;

function field(x:object, key:string):unknown {
  const d = Object.getOwnPropertyDescriptor(x, key);
  if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) throw new Error('Invalid historical chart protocol');
  return d.value;
}

type ChartDecoder = (raw:unknown, historical:boolean) =>
  | Readonly<{status:'ok'; chart:ChartSnapshotV1; provider:ChartProviderV1}>
  | Readonly<{status:string}>;
export function decodeHistoricalChart(raw:unknown, decodeChartResponse:ChartDecoder, expected?:HistoricalChartRequest):HistoricalChartResult {
  if (!plain(raw) || field(raw,'protocolVersion') !== 1) throw new Error('Invalid historical chart protocol');
  const status = field(raw,'status');
  if (status === 'invalid_request' || status === 'provider_unavailable' || status === 'time_source_out_of_range' || status === 'ephemeris_out_of_range' || status === 'calculation_failed') return {kind:status};
  const decoded = decodeChartResponse(raw, true);
  const t = field(raw,'time');
  if (decoded.status !== 'ok' || !('chart' in decoded) || !plain(t)) throw new Error('Invalid historical chart protocol');
  const numeric = ['jdUt1','jdTt','deltaTSeconds','deltaTUncertaintySeconds','civilUncertaintySeconds','offsetSecondsEast'] as const;
  const values = Object.fromEntries(numeric.map(k => [k,field(t,k)]));
  const deltaTSource = field(t,'deltaTSource'), offsetSource = field(t,'offsetSource');
  if (numeric.some(k => typeof values[k] !== 'number' || !Number.isFinite(values[k])) ||
      !nonnegative(values['deltaTUncertaintySeconds']) || !nonnegative(values['civilUncertaintySeconds']) ||
      values['jdUt1'] !== decoded.chart.julianDayUt || !source(deltaTSource) || !source(offsetSource))
    throw new Error('Invalid historical chart protocol');
  const time:HistoricalChartTime = Object.freeze({jdUt1:values['jdUt1'] as number, jdTt:values['jdTt'] as number,
    deltaTSeconds:values['deltaTSeconds'] as number, deltaTUncertaintySeconds:values['deltaTUncertaintySeconds'] as number,
    deltaTSource, civilUncertaintySeconds:values['civilUncertaintySeconds'] as number,
    offsetSecondsEast:values['offsetSecondsEast'] as number, offsetSource});
  if (Math.abs((time.jdTt-time.jdUt1)*86400-time.deltaTSeconds) > 0.001) throw new Error('Invalid historical chart protocol');
  if (expected) {
    const offset=expected.civil.offset, delta=expected.deltaT;
    const seconds=offset.kind === 'localMeanSolar' ? expected.lngMicro / 1e6 * 240 : offset.secondsEast;
    const offsetSource=offset.kind === 'localMeanSolar' ? 'LOCAL_MEAN_SOLAR_TIME' : offset.source.trim();
    const deltaSource=delta.kind === 'espenakMeeus2006' ? 'Espenak-Meeus 2006' : delta.source.trim();
    if (Math.abs(time.offsetSecondsEast-seconds) > 1e-8 || time.offsetSource !== offsetSource ||
        time.deltaTSource !== deltaSource || time.civilUncertaintySeconds !== expected.civil.uncertaintySeconds ||
        time.deltaTUncertaintySeconds !== delta.uncertaintySeconds ||
        (delta.kind === 'supplied' && time.deltaTSeconds !== delta.seconds)) throw new Error('Invalid historical chart protocol');
  }
  return {kind:'ready', chart:decoded.chart, provider:decoded.provider, time};
}

export async function requestHistoricalChart(transport:HistoricalChartTransport, request:HistoricalChartRequest,
  decodeChartResponse:ChartDecoder):Promise<HistoricalChartResult> {
  const input=copyHistoricalChartRequest(request);
  if (!input) return {kind:'invalid_request'};
  try {
    if (!transport.isNative()) return {kind:'not_native'};
    return decodeHistoricalChart(await transport.invoke('calculate_historical_chart', {request:{protocolVersion:1, ...input}}), decodeChartResponse, input);
  } catch { return {kind:'unavailable'}; }
}
