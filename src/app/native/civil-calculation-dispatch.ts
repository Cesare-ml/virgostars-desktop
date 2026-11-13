import type {CivilTimeInput} from './civil-time';
import type {CivilTimeSelectionResult, SelectedCivilInstant} from './civil-time-choice';

/** Structural equivalent of the committed CalculationDraftV1 from the D-01 queue. */
export type CommittedCivilCalculationDraftV1 = Readonly<{
  intent: 'committed';
  utcIso: string;
  latMicro: number;
  lngMicro: number;
  timeZone: string;
  calculationKey: string;
}>;

/** Adapter boundary; the queue remains in draft #47 and is not copied here. */
export interface CivilCalculationSubmissionPort {
  submit(draft: CommittedCivilCalculationDraftV1): number | null;
}

export type CivilCalculationDispatchResult =
  | Readonly<{status: 'submitted'; requestSeq: number; selection: SelectedCivilInstant}>
  | Readonly<{status: 'choice_required'; timeZone: string; choices: readonly {instantUtc: string; offsetSeconds: number}[]}>
  | Readonly<{status: 'nonexistent'; timeZone: string}>
  | Readonly<{status: 'invalid'; code: string}>
  | Readonly<{status: 'selection_invalid' | 'location_invalid' | 'calculation_key_invalid' | 'queue_unavailable'}>;

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * Guarded hand-off from a user-selected civil instant to the future latest-only queue.
 * No astronomical result is interpreted or promoted to a render-ready chart.
 * The caller owns a session-specific opaque calculationKey fingerprint covering ALL
 * calculation-affecting parameters, including the chosen UTC instant and location.
 * This helper deliberately does not derive or log the key from personal birth data.
 */
export function submitCivilCalculation(
  input: CivilTimeInput,
  selectInstant: (input: CivilTimeInput, selectedUtc: string | null) => CivilTimeSelectionResult,
  location: Readonly<{latMicro: number; lngMicro: number}>,
  calculationKey: string,
  queue: CivilCalculationSubmissionPort,
  selectedUtc: string | null = null,
): CivilCalculationDispatchResult {
  // Capture each coordinate once before calling externally supplied code. A
  // mutable/accessor-backed location must not change between validation and
  // queue submission, and a throwing getter must fail closed without logging.
  let latMicro: number;
  let lngMicro: number;
  try {
    latMicro = location.latMicro;
    lngMicro = location.lngMicro;
  } catch {
    return {status:'location_invalid'};
  }
  if (!Number.isSafeInteger(latMicro) || !Number.isSafeInteger(lngMicro) ||
      Math.abs(latMicro) > 90_000_000 || Math.abs(lngMicro) > 180_000_000) {
    return {status:'location_invalid'};
  }
  if (typeof calculationKey !== 'string' || !KEY_PATTERN.test(calculationKey)) {
    return {status:'calculation_key_invalid'};
  }
  // This is the only path to an accepted UTC value. A stale caller selection,
  // DST fold without a choice or skipped local time never reaches the queue.
  let selection;
  try {
    selection = selectInstant(input, selectedUtc);
  } catch {
    return {status:'invalid', code:'TIME_ZONE_UNAVAILABLE'};
  }
  if (selection.status !== 'ready') return selection;

  const draft: CommittedCivilCalculationDraftV1 = {
    intent:'committed', utcIso:selection.instantUtc,
    latMicro, lngMicro,
    timeZone:selection.timeZone, calculationKey,
  };
  try {
    const requestSeq = queue.submit(draft);
    if (typeof requestSeq !== 'number' || !Number.isSafeInteger(requestSeq) || requestSeq < 1) {
      return {status:'queue_unavailable'};
    }
    return {status:'submitted', requestSeq, selection};
  } catch {
    // Keep native/queue failures private; never expose typed birth inputs.
    return {status:'queue_unavailable'};
  }
}

/**
 * A view-scoped latest-only queue can invalidate an older calculation when the
 * civil editor changes, even if the replacement input is no longer valid.
 */
export interface ReplaceableCivilCalculationQueue extends CivilCalculationSubmissionPort {
  invalidate(): void;
}

/**
 * Use on each new civil-input revision, not for unrelated display refreshes.
 * An invalid date, DST gap or missing coordinate must retire any previous
 * in-flight result rather than leaving an obsolete chart eligible to publish.
 * The existing submitCivilCalculation remains available for already-validated
 * immutable drafts and does not implicitly cancel other callers' work.
 */
export function replaceCivilCalculation(
  input: CivilTimeInput,
  selectInstant: (input: CivilTimeInput, selectedUtc: string | null) => CivilTimeSelectionResult,
  location: Readonly<{latMicro: number; lngMicro: number}>,
  calculationKey: string,
  queue: ReplaceableCivilCalculationQueue,
  selectedUtc: string | null = null,
): CivilCalculationDispatchResult {
  try {
    queue.invalidate();
  } catch {
    return {status:'queue_unavailable'};
  }
  return submitCivilCalculation(input, selectInstant, location, calculationKey, queue, selectedUtc);
}
