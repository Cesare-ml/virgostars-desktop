import type { CalculationPort, CalculationRequestV1 } from './calculation-queue';

/**
 * Experimental DE441 geometric positions, NEVER validated apparent astrology.
 * This is a receive-only contract. It does not calculate astronomical data.
 */
export const EXPERIMENTAL_BODIES = [
  'sun', 'moon', 'mercury', 'venus', 'mars_barycenter',
  'jupiter_barycenter', 'saturn_barycenter', 'uranus_barycenter',
  'neptune_barycenter', 'pluto_barycenter',
] as const;

export const REQUIRED_APPROXIMATIONS = [
  'ut1_equals_utc', 'truncated_tdb_minus_tt', 'no_nutation',
  'no_light_time', 'no_aberration', 'no_gravitational_deflection',
  'no_polar_motion', 'no_atmospheric_refraction',
  'outer_planet_system_barycenters',
] as const;

export type ExperimentalBodyId = typeof EXPERIMENTAL_BODIES[number];
export type ExperimentalApproximation = typeof REQUIRED_APPROXIMATIONS[number];

export interface ExperimentalGeometricPositionV1 {
  readonly bodyId: ExperimentalBodyId;
  readonly centerKind: 'body_center' | 'system_barycenter';
  readonly longitudeDeg: number;
  readonly latitudeDeg: number;
  readonly rightAscensionDeg: number;
  readonly declinationDeg: number;
  readonly altitudeDeg: number;
  readonly azimuthDeg: number | null;
  readonly distanceKm: number;
}

/** Strictly an unverified, clearly bounded numerical preview from a future Rust adapter. */
export interface ExperimentalSkySnapshotV1 {
  readonly schemaVersion: 1;
  readonly scientificStatus: 'experimental_unverified';
  readonly provider: 'VirgoStars-Ephemeris';
  readonly sourceFormat: 'DE441_classic_binary';
  /** SHA-256 of the specific external kernel; never a filesystem path. */
  readonly kernelSha256: string;
  readonly utcIso: string;
  readonly latMicro: number;
  readonly lngMicro: number;
  readonly heightMeters: number;
  readonly observerDatum: 'WGS84';
  readonly frame: 'mean_ecliptic_and_equatorial_of_date';
  readonly geometry: 'topocentric_geometric';
  readonly ttJulianDay: number;
  readonly tdbJulianDay: number;
  readonly taiMinusUtcSeconds: number;
  readonly approximations: readonly ExperimentalApproximation[];
  readonly positions: readonly ExperimentalGeometricPositionV1[];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function hasExactKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(obj);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
}
function finiteRange(value: unknown, min: number, max: number, exclusiveMax = false): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min &&
    (exclusiveMax ? value < max : value <= max);
}
const BODY_KEYS = [
  'bodyId', 'centerKind', 'longitudeDeg', 'latitudeDeg', 'rightAscensionDeg',
  'declinationDeg', 'altitudeDeg', 'azimuthDeg', 'distanceKm',
] as const;
const SNAPSHOT_KEYS = [
  'schemaVersion', 'scientificStatus', 'provider', 'sourceFormat',
  'kernelSha256', 'utcIso', 'latMicro', 'lngMicro', 'heightMeters',
  'observerDatum', 'frame', 'geometry', 'ttJulianDay', 'tdbJulianDay',
  'taiMinusUtcSeconds', 'approximations', 'positions',
] as const;

/**
 * Correlate snapshot with the request, not just its outer IPC envelope.
 * Treat all IPC data as untrusted. Strict key allowlists avoid forwarding
 * unexpected paths, files or personal records to a future inspector.
 * True means only that the SHAPE is plausible, NOT that the sky is accurate.
 */
export function isExperimentalSkySnapshotV1(
  raw: unknown,
  request: Pick<CalculationRequestV1, 'utcIso' | 'latMicro' | 'lngMicro'>,
): raw is ExperimentalSkySnapshotV1 {
  if (!record(raw) || !hasExactKeys(raw, SNAPSHOT_KEYS)) return false;
  // Upstream IERS Bulletin C 72 support: 1972-01-01 <= UTC < 2027-06-28.
  // Reject dates the experimental Rust model cannot currently support.
  const epochMs = Date.parse(request.utcIso);
  if (!Number.isFinite(epochMs) || epochMs < Date.UTC(1972, 0, 1) ||
      epochMs >= Date.UTC(2027, 5, 28)) return false;
  if (raw.schemaVersion !== 1 || raw.scientificStatus !== 'experimental_unverified' ||
      raw.provider !== 'VirgoStars-Ephemeris' || raw.sourceFormat !== 'DE441_classic_binary' ||
      typeof raw.kernelSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.kernelSha256) ||
      raw.utcIso !== request.utcIso || raw.latMicro !== request.latMicro ||
      raw.lngMicro !== request.lngMicro ||
      !finiteRange(raw.heightMeters, -12000, 100000) || raw.observerDatum !== 'WGS84' ||
      raw.frame !== 'mean_ecliptic_and_equatorial_of_date' ||
      raw.geometry !== 'topocentric_geometric' ||
      !finiteRange(raw.ttJulianDay, 2400000, 2700000) ||
      !finiteRange(raw.tdbJulianDay, 2400000, 2700000) ||
      Math.abs((raw.tdbJulianDay as number) - (raw.ttJulianDay as number)) > 0.00001 ||
      !Number.isInteger(raw.taiMinusUtcSeconds) ||
      !finiteRange(raw.taiMinusUtcSeconds, 10, 37) ||
      !Array.isArray(raw.approximations) ||
      raw.approximations.length !== REQUIRED_APPROXIMATIONS.length ||
      !Array.isArray(raw.positions) ||
      raw.positions.length !== EXPERIMENTAL_BODIES.length) return false;

  const approximations = new Set<unknown>(raw.approximations);
  if (approximations.size !== REQUIRED_APPROXIMATIONS.length ||
      REQUIRED_APPROXIMATIONS.some(value => !approximations.has(value))) return false;

  const seen = new Set<string>();
  for (const value of raw.positions) {
    if (!record(value) || !hasExactKeys(value, BODY_KEYS)) return false;
    const id = value.bodyId;
    if (typeof id !== 'string' ||
        !(EXPERIMENTAL_BODIES as readonly string[]).includes(id) || seen.has(id)) return false;
    seen.add(id);
    const outer = id.endsWith('_barycenter');
    if (value.centerKind !== (outer ? 'system_barycenter' : 'body_center') ||
        !finiteRange(value.longitudeDeg, 0, 360, true) ||
        !finiteRange(value.latitudeDeg, -90, 90) ||
        !finiteRange(value.rightAscensionDeg, 0, 360, true) ||
        !finiteRange(value.declinationDeg, -90, 90) ||
        !finiteRange(value.altitudeDeg, -90, 90) ||
        !(value.azimuthDeg === null || finiteRange(value.azimuthDeg, 0, 360, true)) ||
        !finiteRange(value.distanceKm, Number.MIN_VALUE, Number.MAX_VALUE)) return false;
  }
  return true;
}

/**
 * Fail-closed adapter for the future experimental Rust path. The current native
 * probe returns only unavailable; this guard will reject any accidental
 * ready answer that lacks a fully disclosed DE441 geometric model.
 * Not connected to chart rendering and not a numerical accuracy certification.
 */
export function guardExperimentalSkyPort(port: CalculationPort): CalculationPort {
  return async (request, signal) => {
    const reply = await port(request, signal);
    if (!record(reply) || reply.status !== 'ready') return reply;
    if (isExperimentalSkySnapshotV1(reply.snapshot, request)) return reply;
    // Deliberately do not expose the original malformed payload.
    return {
      protocolVersion: request.protocolVersion,
      sessionId: request.sessionId,
      requestSeq: request.requestSeq,
      calculationKey: request.calculationKey,
      status: 'invalid_snapshot',
    };
  };
}
