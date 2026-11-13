import type {CivilTimeChoice, CivilTimeInput, CivilTimeResult} from './civil-time';

/** A single verified UTC instant, still subject to native ephemeris date support. */
export type SelectedCivilInstant = Readonly<{
  status: 'ready';
  localDate: string;
  localTime: string;
  timeZone: string;
  instantUtc: string;
  offsetSeconds: number;
  timeZoneSource: 'host_iana_unpinned';
}>;

export type CivilTimeSelectionResult =
  | SelectedCivilInstant
  | Readonly<{status: 'choice_required'; timeZone: string; choices: readonly CivilTimeChoice[]}>
  | Readonly<{status: 'nonexistent'; timeZone: string}>
  | Extract<CivilTimeResult, {status: 'invalid'}>
  | Readonly<{status: 'selection_invalid'}>;

/**
 * Invoke the supplied authoritative civil-time resolver on every call.
 * Re-resolve the current input rather than trusting a stale UI options list.
 * Selection must be exactly one of the resolver's canonical UTC strings.
 * Never choose the first DST fold candidate or normalize a nonexistent hour.
 */
export function selectCivilInstant(
  input: CivilTimeInput,
  resolver: (input: CivilTimeInput) => CivilTimeResult,
  selectedUtc: string | null = null,
): CivilTimeSelectionResult {
  // Snapshot the entire civil tuple before calling an injected resolver. UI
  // accessors may change between reads, and the resolver must not be able to
  // rewrite the requested wall time while producing a UTC candidate.
  if (!input || typeof input !== 'object') return {status:'invalid', code:'INVALID_LOCAL_DATE'};
  let captured: CivilTimeInput;
  try {
    captured = Object.freeze({date:input.date, time:input.time, timeZone:input.timeZone});
  } catch {
    return {status:'invalid', code:'TIME_ZONE_UNAVAILABLE'};
  }
  let result: CivilTimeResult;
  try {
    result = resolver(captured);
  } catch {
    return {status:'invalid', code:'TIME_ZONE_UNAVAILABLE'};
  }
  if (result.status === 'invalid' || result.status === 'nonexistent') return result;
  if (selectedUtc !== null && typeof selectedUtc !== 'string') return {status:'selection_invalid'};

  const candidates = result.status === 'resolved' ? [result.choice] : result.choices;
  if (result.status === 'ambiguous' && selectedUtc === null) {
    return {status:'choice_required', timeZone:result.timeZone, choices:candidates};
  }
  const selected = selectedUtc === null ? candidates[0]
    : candidates.find(option => option.instantUtc === selectedUtc);
  if (!selected) return {status:'selection_invalid'};
  return {
    status:'ready', localDate:captured.date, localTime:captured.time,
    timeZone:result.timeZone, instantUtc:selected.instantUtc,
    offsetSeconds:selected.offsetSeconds, timeZoneSource:'host_iana_unpinned',
  };
}
