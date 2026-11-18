/** Experimental planet-only bridge. UT1 and the source of TT−UT1 are supplied explicitly. */
export type HistoricalBody = 'Sun' | 'Moon' | 'Mercury' | 'Venus' | 'Mars' | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune' | 'Pluto';
export type HistoricalRequest = Readonly<{body: HistoricalBody; jdUt1: number; deltaTSeconds: number; uncertaintySeconds: number; deltaTSource: string}>;
export type HistoricalSensitivitySample = Readonly<{deltaTSeconds: number; longitudeDeg: number; latitudeDeg: number}>;
export type HistoricalSensitivity = Readonly<{lower: HistoricalSensitivitySample; upper: HistoricalSensitivitySample}>;
export type HistoricalPlanet = HistoricalRequest & Readonly<{
  jdTt: number; jdTdb: number; longitudeDeg: number; latitudeDeg: number; distanceAu: number;
  longitudeSpeedDegPerTdbDay: number; latitudeSpeedDegPerTdbDay: number; radialSpeedAuPerTdbDay: number;
  radialCorrectionApplied: boolean;
  sensitivity?: HistoricalSensitivity;
  uncertaintySource?: string;
}>;
export type HistoricalResult = Readonly<{kind: 'ready'; planet: HistoricalPlanet}> |
  Readonly<{kind: 'not_native' | 'invalid_request' | 'provider_unavailable' | 'calculation_failed' | 'unavailable'}>;
export interface HistoricalTransport {
  isNative(): boolean;
  invoke(command: 'calculate_historical_planet', args: {request: HistoricalRequest & {protocolVersion: 1}}): Promise<unknown>;
}
export const HISTORICAL_BODIES: readonly HistoricalBody[] = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function field(value: object, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Invalid historical protocol');
  return descriptor.value;
}
export function validHistoricalRequest(value: HistoricalRequest): boolean {
  return record(value) && HISTORICAL_BODIES.includes(value.body) && Number.isFinite(value.jdUt1) &&
    Number.isFinite(value.deltaTSeconds) && Number.isFinite(value.uncertaintySeconds) && value.uncertaintySeconds >= 0 &&
    typeof value.deltaTSource === 'string' && value.deltaTSource.trim().length > 0 && new TextEncoder().encode(value.deltaTSource).length <= 200;
}
export function decodeHistoricalPlanet(raw: unknown, expected: Readonly<{body: HistoricalBody; uncertaintySeconds?: number;
  deltaTSource: string; jdUt1?: number; deltaTSeconds?: number; includeScenarios?: boolean; uncertaintySource?: string}>): HistoricalResult {
    if (!record(raw) || field(raw, 'protocolVersion') !== 1) throw new Error();
    const status = field(raw, 'status');
    if (status === 'invalid_request' || status === 'provider_unavailable' || status === 'calculation_failed') return {kind: status};
    const result = field(raw, 'result');
    if (status !== 'ok' || !record(result)) throw new Error();
    const keys = ['jdUt1', 'jdTt', 'jdTdb', 'deltaTSeconds', 'uncertaintySeconds', 'longitudeDeg', 'latitudeDeg', 'distanceAu',
      'longitudeSpeedDegPerTdbDay', 'latitudeSpeedDegPerTdbDay', 'radialSpeedAuPerTdbDay'] as const;
    const values = Object.fromEntries(keys.map(key => [key, field(result, key)]));
    if (keys.some(key => typeof values[key] !== 'number' || !Number.isFinite(values[key])) ||
        field(result, 'body') !== expected.body || (expected.jdUt1 !== undefined && values['jdUt1'] !== expected.jdUt1) ||
        (expected.deltaTSeconds !== undefined && values['deltaTSeconds'] !== expected.deltaTSeconds) ||
        (values['uncertaintySeconds'] as number) < 0 ||
        (expected.uncertaintySeconds !== undefined && values['uncertaintySeconds'] !== expected.uncertaintySeconds) ||
        field(result, 'deltaTSource') !== expected.deltaTSource.trim() ||
        typeof field(result, 'radialCorrectionApplied') !== 'boolean' ||
        (values['longitudeDeg'] as number) < 0 || (values['longitudeDeg'] as number) >= 360 ||
        (values['latitudeDeg'] as number) < -90 || (values['latitudeDeg'] as number) > 90 || (values['distanceAu'] as number) <= 0) throw new Error();
    let sensitivity: HistoricalSensitivity | undefined;
    if (expected.includeScenarios) {
      const rawSamples = field(result, 'sensitivity');
      if (!record(rawSamples)) throw new Error();
      const decodeSample = (key: 'lower' | 'upper', offset: number): HistoricalSensitivitySample => {
        const sample = field(rawSamples, key);
        if (!record(sample)) throw new Error();
        const deltaTSeconds = field(sample, 'deltaTSeconds');
        const longitudeDeg = field(sample, 'longitudeDeg');
        const latitudeDeg = field(sample, 'latitudeDeg');
        if (typeof deltaTSeconds !== 'number' || !Number.isFinite(deltaTSeconds) ||
            deltaTSeconds !== (values['deltaTSeconds'] as number) + offset ||
            typeof longitudeDeg !== 'number' || !Number.isFinite(longitudeDeg) || longitudeDeg < 0 || longitudeDeg >= 360 ||
            typeof latitudeDeg !== 'number' || !Number.isFinite(latitudeDeg) || latitudeDeg < -90 || latitudeDeg > 90) throw new Error();
        return Object.freeze({deltaTSeconds, longitudeDeg, latitudeDeg});
      };
      sensitivity = Object.freeze({lower: decodeSample('lower', -(values['uncertaintySeconds'] as number)),
        upper: decodeSample('upper', values['uncertaintySeconds'] as number)});
    }
    if (expected.uncertaintySource !== undefined && field(result, 'uncertaintySource') !== expected.uncertaintySource) throw new Error();
    const planet = Object.freeze({...values, body: expected.body, deltaTSource: expected.deltaTSource.trim(),
      radialCorrectionApplied: field(result, 'radialCorrectionApplied'), ...(sensitivity ? {sensitivity} : {}),
      ...(expected.uncertaintySource ? {uncertaintySource: expected.uncertaintySource} : {})}) as HistoricalPlanet;
    return {kind: 'ready', planet};
}
export async function requestHistoricalPlanet(transport: HistoricalTransport, request: HistoricalRequest): Promise<HistoricalResult> {
  try {
    if (!validHistoricalRequest(request)) return {kind: 'invalid_request'};
    if (!transport.isNative()) return {kind: 'not_native'};
    const raw = await transport.invoke('calculate_historical_planet', {request: {
      protocolVersion: 1, body: request.body, jdUt1: request.jdUt1, deltaTSeconds: request.deltaTSeconds,
      uncertaintySeconds: request.uncertaintySeconds, deltaTSource: request.deltaTSource,
    }});
    return decodeHistoricalPlanet(raw, request);
  } catch {
    return {kind: 'unavailable'};
  }
}
