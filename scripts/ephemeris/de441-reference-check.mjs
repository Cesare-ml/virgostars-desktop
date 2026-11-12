/**
 * Independent-reference comparison gate for experimental DE441 geometry.
 * It computes NO astronomy and never grants production/chart readiness.
 * All tolerances are provisional REVIEW thresholds, not scientific validation.
 */
import { isExperimentalSkySnapshotV1, EXPERIMENTAL_BODIES } from '../../src/app/native/experimental-sky-contract.ts';

export const PROVISIONAL_LIMITS = Object.freeze({
  longitudeDeg: 1 / 3600,
  latitudeDeg: 1 / 3600,
  rightAscensionDeg: 1 / 3600,
  declinationDeg: 1 / 3600,
  altitudeDeg: 0.003,
  azimuthDeg: 0.003,
  distanceKm: 10,
});
const CIRCULAR = new Set(['longitudeDeg', 'rightAscensionDeg', 'azimuthDeg']);
const FIELDS = Object.freeze(Object.keys(PROVISIONAL_LIMITS));
const REF_KEYS = Object.freeze([
  'schemaVersion', 'sourceKind', 'sourceId', 'sourceDocumentSha256',
  'transformMethodId', 'utcIso', 'latMicro', 'lngMicro', 'heightMeters',
  'observerDatum', 'frame', 'geometry', 'positions',
]);
const POSITION_KEYS = Object.freeze([
  'bodyId', 'centerKind', 'longitudeDeg', 'latitudeDeg', 'rightAscensionDeg',
  'declinationDeg', 'altitudeDeg', 'azimuthDeg', 'distanceKm',
]);
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => isObj(x) && Object.keys(x).length === keys.length &&
  Object.keys(x).every(k => keys.includes(k));
const finite = x => typeof x === 'number' && Number.isFinite(x);
const canonicalIso = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) &&
  Number.isFinite(Date.parse(x)) && new Date(Date.parse(x)).toISOString() === x;
const validAngle = (x, start, end, exclusiveEnd = false) => finite(x) && x >= start &&
  (exclusiveEnd ? x < end : x <= end);

export function referenceShapeValid(ref, snapshot) {
  if (!exact(ref, REF_KEYS) || !isObj(snapshot) ||
      ref.schemaVersion !== 1 ||
      !['JPL_HORIZONS', 'NAIF_SPICE'].includes(ref.sourceKind) ||
      typeof ref.sourceId !== 'string' || !/^[a-zA-Z0-9_:.\-]{8,128}$/.test(ref.sourceId) ||
      typeof ref.transformMethodId !== 'string' || !/^[a-zA-Z0-9_:.\-]{8,128}$/.test(ref.transformMethodId) ||
      typeof ref.sourceDocumentSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(ref.sourceDocumentSha256) ||
      !canonicalIso(ref.utcIso) || ref.utcIso !== snapshot.utcIso ||
      ref.latMicro !== snapshot.latMicro || ref.lngMicro !== snapshot.lngMicro ||
      ref.heightMeters !== snapshot.heightMeters ||
      ref.observerDatum !== 'WGS84' || ref.frame !== 'mean_ecliptic_and_equatorial_of_date' ||
      ref.geometry !== 'topocentric_geometric' ||
      !Array.isArray(ref.positions) || ref.positions.length !== EXPERIMENTAL_BODIES.length) return false;
  const byId = new Set();
  for (const body of ref.positions) {
    if (!exact(body, POSITION_KEYS) || typeof body.bodyId !== 'string' ||
        !EXPERIMENTAL_BODIES.includes(body.bodyId) || byId.has(body.bodyId)) return false;
    byId.add(body.bodyId);
    if (body.centerKind !== (body.bodyId.endsWith('_barycenter') ? 'system_barycenter' : 'body_center') ||
        !validAngle(body.longitudeDeg, 0, 360, true) || !validAngle(body.latitudeDeg, -90, 90) ||
        !validAngle(body.rightAscensionDeg, 0, 360, true) ||
        !validAngle(body.declinationDeg, -90, 90) || !validAngle(body.altitudeDeg, -90, 90) ||
        !(body.azimuthDeg === null || validAngle(body.azimuthDeg, 0, 360, true)) ||
        !finite(body.distanceKm) || body.distanceKm <= 0) return false;
  }
  return true;
}

/** Smallest unsigned angular separation across 0/360. No latitude wrapping. */
export function angularDifferenceDegrees(a, b) {
  if (!finite(a) || !finite(b)) return NaN;
  const delta = ((a - b) % 360 + 360) % 360;
  return Math.min(delta, 360 - delta);
}

/**
 * Repeated synthetic data can test the comparator, but is NOT independent proof.
 * This only says all fields are within the fixed provisional review thresholds.
 */
export function compareExperimentalToReference(snapshot, reference) {
  const request = {utcIso: snapshot?.utcIso, latMicro: snapshot?.latMicro, lngMicro: snapshot?.lngMicro};
  if (!isExperimentalSkySnapshotV1(snapshot, request) || !referenceShapeValid(reference, snapshot)) {
    return {kind: 'invalid_input', failures: []};
  }
  const referenceById = new Map(reference.positions.map(p => [p.bodyId, p]));
  const failures = [];
  const maximum = Object.fromEntries(FIELDS.map(field => [field, 0]));
  for (const body of snapshot.positions) {
    const expected = referenceById.get(body.bodyId);
    for (const field of FIELDS) {
      const a = body[field];
      const b = expected[field];
      const delta = a === null && b === null ? 0 :
        a === null || b === null ? Infinity :
        CIRCULAR.has(field) ? angularDifferenceDegrees(a, b) : Math.abs(a - b);
      maximum[field] = Math.max(maximum[field], delta);
      if (delta > PROVISIONAL_LIMITS[field]) failures.push({bodyId:body.bodyId,field});
    }
  }
  return {kind: failures.length ? 'mismatch' : 'within_provisional_tolerance',
    failures, maximum};
}
