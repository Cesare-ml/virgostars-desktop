import type { CalculationPort, CalculationRequestV1 } from './calculation-queue';

/**
 * Prevent an experimental geometric ephemeris preview from being mistaken for
 * a user-ready astrological sky. This gate intentionally has NO accept/override
 * flag: a separately reviewed, numerically validated provider must replace it.
 */
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function correlatedUnavailable(request: CalculationRequestV1, experimental: boolean) {
  return {
    protocolVersion: request.protocolVersion,
    sessionId: request.sessionId,
    requestSeq: request.requestSeq,
    calculationKey: request.calculationKey,
    status: experimental ? 'unsupported' : 'invalid_snapshot',
    reasonCode: experimental ? 'EXPERIMENTAL_SKY_NOT_VALIDATED' : 'UNRECOGNIZED_SKY_SNAPSHOT',
  };
}

/**
 * Receive-only adapter. The experimental Rust path may eventually expose
 * geometric DE441 previews, but it has not passed independent astronomical
 * validation and MUST NOT supply chart-ready results.
 *
 * Apply after guardExperimentalSkyPort (which checks the complete preview
 * schema), so only well-formed experimental snapshots reach this boundary.
 * This function strips all ready payloads; the desktop stays unavailable for
 * real astronomical calculations until a reviewed replacement is integrated.
 */
export function quarantineUnverifiedSkyPort(port: CalculationPort): CalculationPort {
  return async (request, signal) => {
    const reply = await port(request, signal);
    if (signal.aborted) throw new Error('CALC_ABORTED');
    if (!record(reply) || reply.status !== 'ready') return reply;
    const experimental = record(reply.snapshot) &&
      reply.snapshot.scientificStatus === 'experimental_unverified';
    // Never forward arbitrary snapshot fields, sensitive metadata, or fabricated
    // validation claims. Outer correlation is re-created from the request.
    return correlatedUnavailable(request, experimental);
  };
}
