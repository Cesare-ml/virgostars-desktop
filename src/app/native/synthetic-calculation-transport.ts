import type {CalculationRequest, CalculationResponse, CalculationTransport} from './latest-calculation-scheduler';

/** Explicit benchmark-only payload, never a birth record or planetary position. */
export interface SyntheticProbeInput {readonly seed: number; readonly iterations: number;}
export interface SyntheticProbeResult {
  readonly syntheticOnly: true;
  readonly fixtureKind: 'synthetic_ipc_probe';
  readonly iterations: number;
  readonly checksumHex: string;
  readonly workerMicros: number;
}
export interface SyntheticInvokePort {
  isNative(): boolean;
  invoke(command: 'synthetic_calculation_probe', args: {request: CalculationRequest<SyntheticProbeInput>}): Promise<unknown>;
}
const token = /^[A-Za-z0-9:_-]{1,128}$/;
const UINT32_MAX = 4_294_967_295;
const MAX_ITERATIONS = 200_000;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function uint(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}
function validateRequest(request: CalculationRequest<SyntheticProbeInput>): void {
  if (request.protocolVersion !== 1 || !token.test(request.sessionId) || !token.test(request.calculationKey) ||
      !uint(request.requestSeq, Number.MAX_SAFE_INTEGER) || request.requestSeq === 0 ||
      !record(request.input) || !uint(request.input.seed, UINT32_MAX) ||
      !uint(request.input.iterations, MAX_ITERATIONS) || request.input.iterations === 0) {
    throw new Error('SYNTHETIC_INVALID_REQUEST');
  }
}
/** Strict fail-closed result parser. Unknown fields are not forwarded to callers. */
export function decodeSyntheticResponse(raw: unknown, request: CalculationRequest<SyntheticProbeInput>): CalculationResponse<SyntheticProbeResult> {
  if (!record(raw) || raw.protocolVersion !== 1 || raw.sessionId !== request.sessionId ||
      raw.requestSeq !== request.requestSeq || raw.calculationKey !== request.calculationKey ||
      !record(raw.result)) throw new Error('SYNTHETIC_INVALID_RESPONSE');
  const result = raw.result;
  if (result.syntheticOnly !== true || result.fixtureKind !== 'synthetic_ipc_probe' ||
      result.iterations !== request.input.iterations ||
      typeof result.checksumHex !== 'string' || !/^[0-9a-f]{8}$/.test(result.checksumHex) ||
      !uint(result.workerMicros, UINT32_MAX)) throw new Error('SYNTHETIC_INVALID_RESPONSE');
  return {
    protocolVersion: 1, sessionId: request.sessionId, requestSeq: request.requestSeq,
    calculationKey: request.calculationKey,
    result: {
      syntheticOnly: true, fixtureKind: 'synthetic_ipc_probe',
      iterations: result.iterations as number, checksumHex: result.checksumHex,
      workerMicros: result.workerMicros as number,
    },
  };
}
/** No automatic network fallback, chart updates or collection of birth details. */
export class SyntheticCalculationTransport implements CalculationTransport<SyntheticProbeInput, SyntheticProbeResult> {
  private readonly port: SyntheticInvokePort;
  constructor(port: SyntheticInvokePort) { this.port = port; }
  async calculate(request: CalculationRequest<SyntheticProbeInput>): Promise<CalculationResponse<SyntheticProbeResult>> {
    validateRequest(request);
    if (!this.port.isNative()) throw new Error('SYNTHETIC_NOT_NATIVE');
    const raw = await this.port.invoke('synthetic_calculation_probe', {request});
    return decodeSyntheticResponse(raw, request);
  }
}
