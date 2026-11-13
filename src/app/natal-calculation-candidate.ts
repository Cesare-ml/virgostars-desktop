import type {NatalDraftState} from './natal-draft-state';
import type {NatalPreviewAnchor} from './natal-preview-freshness';
import type {CivilTimeResolution, UtcCandidate, TimezoneCaution} from './timezone-civil';

/** Native-side scientific coverage is NOT inferred from a calendar or kernel name. */
export interface DeclaredProviderCoverage {
  readonly providerId: string;
  readonly earliestUtc: string;
  readonly latestUtc: string;
}

/** Data for a later *independent* Rust recheck; NOT a calculation or valid ephemeris. */
export type ProvisionalNatalCandidate = Readonly<{
  status: 'provisional_only';
  protocolVersion: 1;
  instantUtc: string;
  latMicro: number;
  lngMicro: number;
  timeZone: string;
  offsetSeconds: number;
  tzdbVersion: string;
  tzdbCaution: TimezoneCaution;
  timeZoneProvenance: 'bundled_moment_unverified';
  declaredProviderId: string;
}>;

export type NatalCandidateResult =
  | ProvisionalNatalCandidate
  | Readonly<{status: 'stale_preview' | 'time_unknown' | 'civil_range_unsupported' |
    'timezone_mismatch' | 'resolution_unavailable' | 'invalid_candidates' |
    'selection_required' | 'selection_invalid' | 'coverage_unavailable' | 'outside_provider_range'}>;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function canonicalEpoch(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) return null;
  const epoch=Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString()===value ? epoch : null;
}

function checkedCoverage(value: DeclaredProviderCoverage | null):
  Readonly<{start: number; end: number; providerId: string}> | null {
  if (!value || typeof value.providerId !== 'string' ||
      !/^[A-Za-z0-9_.-]{1,80}$/.test(value.providerId)) return null;
  const start=canonicalEpoch(value.earliestUtc);
  const end=canonicalEpoch(value.latestUtc);
  return start===null || end===null || start>end ? null : {start,end,providerId:value.providerId};
}

function validCandidate(candidate: UtcCandidate, civil: Readonly<{
  year:number;month:number;day:number;hour:number|null;minute:number|null;
}>): boolean {
  if (!candidate || typeof candidate.epochMs !== 'number' ||
      !Number.isSafeInteger(candidate.epochMs) ||
      !Number.isFinite(candidate.offsetMinutesEast) ||
      Math.abs(candidate.offsetMinutesEast)>1440) return false;
  const epoch=canonicalEpoch(candidate.isoUtc);
  if (epoch===null || epoch!==candidate.epochMs) return false;
  const shift=candidate.offsetMinutesEast * 60_000;
  if (!Number.isSafeInteger(shift)) return false;
  const wall=new Date(epoch+shift);
  return Number.isFinite(wall.getTime()) &&
    wall.getUTCFullYear()===civil.year && wall.getUTCMonth()+1===civil.month &&
    wall.getUTCDate()===civil.day && wall.getUTCHours()===civil.hour &&
    wall.getUTCMinutes()===civil.minute && wall.getUTCSeconds()===0 &&
    wall.getUTCMilliseconds()===0;
}

/**
 * A pure, fail-closed composition gate between the ONE natal editor (#63)
 * and a future native scientific validation provider.
 *
 * isCurrent should be supplied by isNatalPreviewCurrent. We never invoke
 * Tauri, calculate astronomy, persist data, generate a correlation key,
 * or claim bundled timezone data is authoritative.
 */
export function prepareProvisionalNatalCandidate(
  draft: NatalDraftState,
  anchor: NatalPreviewAnchor | null,
  isCurrent: (draft: NatalDraftState, anchor: NatalPreviewAnchor | null) => boolean,
  resolution: CivilTimeResolution | null,
  selectedUtc: string | null,
  coverage: DeclaredProviderCoverage | null,
): NatalCandidateResult {
  try {
    if (!isCurrent(draft,anchor) || !anchor) return {status:'stale_preview'};
  } catch { return {status:'stale_preview'}; }
  const preview=anchor.preview;
  if (!preview.civil.birthTimeKnown || preview.civil.hour===null ||
      preview.civil.minute===null) return {status:'time_unknown'};
  // The separate #52/#61 pipeline currently accepts years 1900–2100 only.
  // A real native provider may support LESS, never silently extend that window.
  if (preview.civil.year<1900 || preview.civil.year>2100) {
    return {status:'civil_range_unsupported'};
  }
  const place=preview.place;
  if (!place.timeZone || !resolution || resolution.timezone!==place.timeZone) {
    return {status:'timezone_mismatch'};
  }
  if (resolution.status==='unknown_birth_time' || resolution.status==='nonexistent' ||
      resolution.status==='zone_missing' || resolution.status==='invalid_date' ||
      resolution.status==='invalid_zone_data') return {status:'resolution_unavailable'};
  if (resolution.status!=='unique' && resolution.status!=='ambiguous') {
    return {status:'resolution_unavailable'};
  }
  if (typeof resolution.tzdbVersion!=='string' || resolution.tzdbVersion==='unknown' ||
      !/^[A-Za-z0-9_.-]{2,40}$/.test(resolution.tzdbVersion)) {
    return {status:'resolution_unavailable'};
  }
  const candidates=resolution.candidates;
  if (!Array.isArray(candidates) || ![null,'pre_1970','future_rules'].includes(resolution.caution)) {
    return {status:'invalid_candidates'};
  }
  const expectedCount=resolution.status==='unique'?1:2;
  if (candidates.length!==expectedCount || !candidates.every(c=>validCandidate(c,preview.civil)) ||
      (expectedCount===2 && candidates[0].epochMs>=candidates[1].epochMs)) {
    return {status:'invalid_candidates'};
  }
  if (resolution.status==='ambiguous' && selectedUtc===null) {
    return {status:'selection_required'};
  }
  const chosen=selectedUtc===null?candidates[0]:candidates.find(c=>c.isoUtc===selectedUtc);
  if (!chosen) return {status:'selection_invalid'};
  const range=checkedCoverage(coverage);
  if (!range) return {status:'coverage_unavailable'};
  if (chosen.epochMs<range.start || chosen.epochMs>range.end) {
    return {status:'outside_provider_range'};
  }
  // Deliberate projection: no name, country, city ID, archive or contact data.
  return {
    status:'provisional_only', protocolVersion:1, instantUtc:chosen.isoUtc,
    latMicro:place.latMicro,lngMicro:place.lngMicro,timeZone:place.timeZone,
    offsetSeconds:Math.round(chosen.offsetMinutesEast*60),
    tzdbVersion:resolution.tzdbVersion,tzdbCaution:resolution.caution,
    timeZoneProvenance:'bundled_moment_unverified',declaredProviderId:range.providerId,
  };
}
