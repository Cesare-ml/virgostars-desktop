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
  const result = resolver(input);
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
    status:'ready', localDate:input.date, localTime:input.time,
    timeZone:result.timeZone, instantUtc:selected.instantUtc,
    offsetSeconds:selected.offsetSeconds, timeZoneSource:'host_iana_unpinned',
  };
}
