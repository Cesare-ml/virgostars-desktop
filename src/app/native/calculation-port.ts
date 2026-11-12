import type { CalculationDraftV1, CalculationPort, CalculationRequestV1 } from './calculation-queue';

/** Injectable Tauri bridge boundary, deliberately free of real ephemeris math. */
export interface NativeCalculationTransport {
  isNative(): boolean;
  invoke(command: 'desktop_calculation_probe', args: {request: CalculationRequestV1}): Promise<unknown>;
}

function validEnvelope(request: CalculationRequestV1, validateDraft: (draft: CalculationDraftV1) => boolean): boolean {
  return request.protocolVersion === 1 &&
    /^[A-Za-z0-9_-]{1,80}$/.test(request.sessionId) &&
    Number.isSafeInteger(request.requestSeq) && request.requestSeq > 0 &&
    validateDraft(request);
}

/**
 * Fail closed when native IPC is unavailable. No HTTP, fallback sky, secrets,
 * or WebView local persistence. Abort is advisory until Rust supports it:
 * the latest-only queue independently rejects obsolete responses.
 */
export function createNativeCalculationPort(
  transport: NativeCalculationTransport, validateDraft: (draft: CalculationDraftV1) => boolean
): CalculationPort {
  return async (request, signal) => {
    if (signal.aborted || !validEnvelope(request, validateDraft)) throw new Error('CALC_REQUEST_INVALID');
    if (!transport.isNative()) throw new Error('CALC_NATIVE_UNAVAILABLE');
    // Explicit projection: never send unintended fields from an untrusted caller.
    const bounded: CalculationRequestV1 = {
      protocolVersion: 1,
      sessionId: request.sessionId,
      requestSeq: request.requestSeq,
      intent: request.intent,
      utcIso: request.utcIso,
      latMicro: request.latMicro,
      lngMicro: request.lngMicro,
      timeZone: request.timeZone,
      calculationKey: request.calculationKey,
    };
    const response = await transport.invoke('desktop_calculation_probe', {request: bounded});
    if (signal.aborted) throw new Error('CALC_ABORTED');
    return response;
  };
}
