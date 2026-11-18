/**
 * Solar and lunar return search contract shared with the Rust `find_returns`
 * command. A longitude and a UTC calendar year go in; the instants at which the
 * Sun or Moon is back at that longitude come out. Nothing here is astronomy.
 */
import type {ChartProviderV1} from './chart-calculation-contract';

export type ReturnBody = 'Sun' | 'Moon';

export type ReturnRequestV1 = Readonly<{body: ReturnBody; targetLongitudeDeg: number; year: number}>;

export type ReturnInstantV1 = Readonly<{utcIso: string; julianDayUt: number}>;

export type ReturnSearchResult =
  | Readonly<{kind: 'ready'; provider: ChartProviderV1; instants: readonly ReturnInstantV1[]}>
  | Readonly<{kind: 'not_native' | 'provider_unavailable' | 'invalid_request' | 'calculation_failed' | 'unavailable'}>;

export interface ReturnSearchTransport {
  isNative(): boolean;
  invoke(
    command: 'find_returns',
    args: {request: {protocolVersion: 1; body: ReturnBody; targetLongitudeDeg: number; year: number}},
  ): Promise<unknown>;
}

const PROTOCOL_ERROR = 'Invalid return search protocol';
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UNIX_EPOCH_JULIAN_DAY = 2_440_587.5;
const MILLIS_PER_DAY = 86_400_000;
/** A lunar year holds at most 14 returns; leave a little room. */
const MAX_INSTANTS = 16;
export const MIN_RETURN_YEAR = 1600;
export const MAX_RETURN_YEAR = 2400;

function plainObject(x: unknown): x is Record<string, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const prototype = Object.getPrototypeOf(x);
  return prototype === Object.prototype || prototype === null;
}

/** Read one own data property: never a getter, never an inherited value. */
function field(source: object, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, name);
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error(PROTOCOL_ERROR);
  return descriptor.value;
}

function decodeInstant(raw: unknown, previousJulianDay: number): ReturnInstantV1 {
  if (!plainObject(raw)) throw new Error(PROTOCOL_ERROR);
  const utcIso = field(raw, 'utcIso');
  const julianDayUt = field(raw, 'julianDayUt');
  if (typeof utcIso !== 'string' || !UTC_PATTERN.test(utcIso) ||
      typeof julianDayUt !== 'number' || !Number.isFinite(julianDayUt) || julianDayUt <= previousJulianDay) {
    throw new Error(PROTOCOL_ERROR);
  }
  // The two forms of the same instant must agree to the rounding of the text.
  const fromText = Date.parse(utcIso);
  const fromJulianDay = (julianDayUt - UNIX_EPOCH_JULIAN_DAY) * MILLIS_PER_DAY;
  if (!Number.isFinite(fromText) || Math.abs(fromText - fromJulianDay) > 1) throw new Error(PROTOCOL_ERROR);
  return Object.freeze({utcIso, julianDayUt});
}

type DecodedReturns =
  | Readonly<{status: 'ok'; provider: ChartProviderV1; instants: readonly ReturnInstantV1[]}>
  | Readonly<{status: 'provider_unavailable' | 'invalid_request' | 'calculation_failed'}>;

/** Detached, frozen values from one native response; throws a generic error otherwise. */
export function decodeReturnResponse(raw: unknown): DecodedReturns {
  try {
    if (!plainObject(raw) || field(raw, 'protocolVersion') !== 1) throw new Error(PROTOCOL_ERROR);
    const status = field(raw, 'status');
    if (status === 'provider_unavailable' || status === 'invalid_request' || status === 'calculation_failed') {
      return Object.freeze({status});
    }
    const provider = field(raw, 'provider');
    const instants = field(raw, 'instants');
    if (status !== 'ok' || !plainObject(provider) || !Array.isArray(instants) ||
        Object.getPrototypeOf(instants) !== Array.prototype || instants.length > MAX_INSTANTS ||
        Reflect.ownKeys(instants).length !== instants.length + 1) {
      throw new Error(PROTOCOL_ERROR);
    }
    const id = field(provider, 'id');
    const engineVersion = field(provider, 'engineVersion');
    if (typeof id !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(id) ||
        typeof engineVersion !== 'string' || !/^[A-Za-z0-9._-]{1,40}$/.test(engineVersion)) {
      throw new Error(PROTOCOL_ERROR);
    }
    const decoded: ReturnInstantV1[] = [];
    for (let index = 0; index < instants.length; index++) {
      const previous = decoded.length ? decoded[decoded.length - 1].julianDayUt : Number.NEGATIVE_INFINITY;
      decoded.push(decodeInstant(field(instants, String(index)), previous));
    }
    return Object.freeze({status: 'ok', provider: Object.freeze({id, engineVersion}), instants: Object.freeze(decoded)});
  } catch {
    // Never surface native details, accessor or Proxy trap messages.
    throw new Error(PROTOCOL_ERROR);
  }
}

export function validReturnRequest(request: ReturnRequestV1): boolean {
  return plainObject(request) && (request.body === 'Sun' || request.body === 'Moon') &&
    typeof request.targetLongitudeDeg === 'number' && Number.isFinite(request.targetLongitudeDeg) &&
    request.targetLongitudeDeg >= 0 && request.targetLongitudeDeg < 360 &&
    Number.isSafeInteger(request.year) && request.year >= MIN_RETURN_YEAR && request.year <= MAX_RETURN_YEAR;
}

/** One native call per search; failures are reduced to a small set of states. */
export async function requestReturns(
  transport: ReturnSearchTransport,
  request: ReturnRequestV1,
): Promise<ReturnSearchResult> {
  if (!validReturnRequest(request)) return {kind: 'invalid_request'};
  try {
    if (!transport.isNative()) return {kind: 'not_native'};
    const raw = await transport.invoke('find_returns', {
      request: {protocolVersion: 1, body: request.body, targetLongitudeDeg: request.targetLongitudeDeg, year: request.year},
    });
    const decoded = decodeReturnResponse(raw);
    if (decoded.status === 'ok') {
      // The native search is scoped to one UTC calendar year. Do not display
      // a return from an adjacent year as if it belonged to this request.
      const yearText = String(request.year);
      if (decoded.instants.some(instant => instant.utcIso.slice(0, 4) !== yearText)) {
        return {kind: 'unavailable'};
      }
      return {kind: 'ready', provider: decoded.provider, instants: decoded.instants};
    }
    return {kind: decoded.status};
  } catch {
    return {kind: 'unavailable'};
  }
}
