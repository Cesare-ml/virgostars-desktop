/**
 * Offline comparative audit of EXPERIMENTAL geometric sky against independently
 * normalized reference numbers. Never certifies astronomical accuracy.
 * No astronomy is computed here: only dimension/angle-aware comparisons.
 */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const BODIES = [
  'sun', 'moon', 'mercury', 'venus', 'mars_barycenter', 'jupiter_barycenter',
  'saturn_barycenter', 'uranus_barycenter', 'neptune_barycenter', 'pluto_barycenter',
];
const APPROXIMATIONS = [
  'ut1_equals_utc', 'truncated_tdb_minus_tt', 'no_nutation',
  'no_light_time', 'no_aberration', 'no_gravitational_deflection',
  'no_polar_motion', 'no_atmospheric_refraction', 'outer_planet_system_barycenters',
];
const POS_KEYS = [
  'bodyId', 'centerKind', 'longitudeDeg', 'latitudeDeg', 'rightAscensionDeg',
  'declinationDeg', 'altitudeDeg', 'azimuthDeg', 'distanceKm',
];
const ACTUAL_KEYS = [
  'schemaVersion', 'scientificStatus', 'provider', 'sourceFormat', 'kernelSha256',
  'utcIso', 'latMicro', 'lngMicro', 'heightMeters', 'observerDatum', 'frame',
  'geometry', 'ttJulianDay', 'tdbJulianDay', 'taiMinusUtcSeconds',
  'approximations', 'positions',
];
const REF_KEYS = [
  'schemaVersion', 'provenance', 'utcIso', 'latMicro', 'lngMicro',
  'heightMeters', 'observerDatum', 'frame', 'geometry', 'ttJulianDay',
  'tdbJulianDay', 'taiMinusUtcSeconds', 'approximations', 'positions',
];
const PROVENANCE_KEYS = [
  'source', 'rawResponseSha256', 'querySha256', 'normalizationCodeSha256',
  'normalizationNotes',
];
const HASH = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const READ_BLOCK = 1024 * 1024;

function record(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function exact(x, keys) {
  return record(x) && Object.keys(x).length === keys.length &&
    Object.keys(x).every(k => keys.includes(k));
}
function finite(x, lo, hi, upperExclusive = false) {
  return typeof x === 'number' && Number.isFinite(x) && x >= lo &&
    (upperExclusive ? x < hi : x <= hi);
}
function validIso(s) {
  if (typeof s !== 'string' || !ISO.test(s)) return false;
  const epoch = Date.parse(s);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === s &&
    epoch >= Date.UTC(1972, 0, 1) && epoch < Date.UTC(2027, 5, 28);
}
function validApproximations(a) {
  return Array.isArray(a) && a.length === APPROXIMATIONS.length &&
    new Set(a).size === a.length && APPROXIMATIONS.every(x => a.includes(x));
}
function validPositions(positions) {
  if (!Array.isArray(positions) || positions.length !== BODIES.length) return false;
  const seen = new Set();
  for (const p of positions) {
    if (!exact(p, POS_KEYS) || !BODIES.includes(p.bodyId) || seen.has(p.bodyId)) return false;
    seen.add(p.bodyId);
    if (p.centerKind !== (p.bodyId.endsWith('_barycenter') ? 'system_barycenter' : 'body_center') ||
        !finite(p.longitudeDeg, 0, 360, true) || !finite(p.latitudeDeg, -90, 90) ||
        !finite(p.rightAscensionDeg, 0, 360, true) || !finite(p.declinationDeg, -90, 90) ||
        !finite(p.altitudeDeg, -90, 90) ||
        !(p.azimuthDeg === null || finite(p.azimuthDeg, 0, 360, true)) ||
        !finite(p.distanceKm, Number.MIN_VALUE, Number.MAX_VALUE)) return false;
  }
  return true;
}
function validCommon(s) {
  return validIso(s.utcIso) && Number.isSafeInteger(s.latMicro) &&
    Math.abs(s.latMicro) <= 90_000_000 && Number.isSafeInteger(s.lngMicro) &&
    Math.abs(s.lngMicro) <= 180_000_000 && finite(s.heightMeters, -12000, 100000) &&
    s.observerDatum === 'WGS84' &&
    s.frame === 'mean_ecliptic_and_equatorial_of_date' &&
    s.geometry === 'topocentric_geometric' &&
    finite(s.ttJulianDay, 2400000, 2700000) &&
    finite(s.tdbJulianDay, 2400000, 2700000) &&
    Math.abs(s.ttJulianDay - s.tdbJulianDay) <= 0.00001 &&
    Number.isInteger(s.taiMinusUtcSeconds) && finite(s.taiMinusUtcSeconds, 10, 37) &&
    validApproximations(s.approximations) && validPositions(s.positions);
}
function validActual(actual) {
  return exact(actual, ACTUAL_KEYS) && actual.schemaVersion === 1 &&
    actual.scientificStatus === 'experimental_unverified' &&
    actual.provider === 'VirgoStars-Ephemeris' &&
    actual.sourceFormat === 'DE441_classic_binary' && HASH.test(actual.kernelSha256) &&
    validCommon(actual);
}
function validReference(reference) {
  const p = reference?.provenance;
  return exact(reference, REF_KEYS) && reference.schemaVersion === 1 &&
    exact(p, PROVENANCE_KEYS) && p.source === 'JPL_HORIZONS' &&
    HASH.test(p.rawResponseSha256) && HASH.test(p.querySha256) &&
    HASH.test(p.normalizationCodeSha256) &&
    typeof p.normalizationNotes === 'string' &&
    p.normalizationNotes.length >= 20 && p.normalizationNotes.length <= 400 &&
    /^[\x20-\x7e]+$/.test(p.normalizationNotes) && validCommon(reference);
}
function validTolerance(t) {
  return exact(t, ['maxDirectionArcsec', 'maxDistancePpm', 'maxEpochSeconds']) &&
    finite(t.maxDirectionArcsec, Number.MIN_VALUE, 3600) &&
    finite(t.maxDistancePpm, Number.MIN_VALUE, 1000000) &&
    finite(t.maxEpochSeconds, Number.MIN_VALUE, 1);
}

/** True 3D angular separation, robust when longitude wraps from 359.9 to 0.1. */
export function sphericalSeparationArcsec(lonA, latA, lonB, latB) {
  const r = Math.PI / 180;
  const latDifference = (latB - latA) * r;
  const lonDifference = (lonB - lonA) * r;
  const s = Math.sin(latDifference / 2) ** 2 +
    Math.cos(latA * r) * Math.cos(latB * r) * Math.sin(lonDifference / 2) ** 2;
  return (2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, s))))) / r * 3600;
}

/**
 * A PASS means ONLY that user-supplied normalized numbers agree within the
 * user-supplied tolerance. It must never be interpreted as sky certification.
 */
export function compareExperimentalSky(actual, reference, rawSourceSha256, tolerance) {
  if (!validTolerance(tolerance)) return { status:'INCOMPARABLE', reason:'INVALID_TOLERANCE' };
  if (!validActual(actual)) return { status:'INCOMPARABLE', reason:'INVALID_EXPERIMENTAL_SNAPSHOT' };
  if (!validReference(reference) || !HASH.test(rawSourceSha256 ?? '') ||
      reference.provenance.rawResponseSha256 !== rawSourceSha256) {
    return { status:'INCOMPARABLE', reason:'REFERENCE_PROVENANCE_UNVERIFIED' };
  }
  if (reference.utcIso !== actual.utcIso || reference.latMicro !== actual.latMicro ||
      reference.lngMicro !== actual.lngMicro || reference.heightMeters !== actual.heightMeters ||
      reference.observerDatum !== actual.observerDatum || reference.frame !== actual.frame ||
      reference.geometry !== actual.geometry || reference.taiMinusUtcSeconds !== actual.taiMinusUtcSeconds ||
      !validApproximations(reference.approximations)) {
    return { status:'INCOMPARABLE', reason:'MODEL_OR_OBSERVER_MISMATCH' };
  }
  const timeErrorSeconds = Math.max(Math.abs(reference.ttJulianDay - actual.ttJulianDay),
    Math.abs(reference.tdbJulianDay - actual.tdbJulianDay)) * 86400;
  let maxDirectionArcsec = 0, maxDistancePpm = 0;
  const referenceByBody = new Map(reference.positions.map(p => [p.bodyId, p]));
  for (const ours of actual.positions) {
    const theirs = referenceByBody.get(ours.bodyId);
    if (!theirs || theirs.centerKind !== ours.centerKind ||
        (ours.azimuthDeg === null) !== (theirs.azimuthDeg === null)) {
      return { status:'INCOMPARABLE', reason:'BODY_OR_AZIMUTH_MISMATCH' };
    }
    const ecliptic = sphericalSeparationArcsec(ours.longitudeDeg, ours.latitudeDeg,
      theirs.longitudeDeg, theirs.latitudeDeg);
    const equatorial = sphericalSeparationArcsec(ours.rightAscensionDeg, ours.declinationDeg,
      theirs.rightAscensionDeg, theirs.declinationDeg);
    const horizontal = ours.azimuthDeg === null
      ? Math.abs(ours.altitudeDeg - theirs.altitudeDeg) * 3600
      : sphericalSeparationArcsec(ours.azimuthDeg, ours.altitudeDeg,
          theirs.azimuthDeg, theirs.altitudeDeg);
    const ppm = Math.abs(ours.distanceKm - theirs.distanceKm) / theirs.distanceKm * 1e6;
    maxDirectionArcsec = Math.max(maxDirectionArcsec, ecliptic, equatorial, horizontal);
    maxDistancePpm = Math.max(maxDistancePpm, ppm);
  }
  const within = maxDirectionArcsec <= tolerance.maxDirectionArcsec &&
    maxDistancePpm <= tolerance.maxDistancePpm &&
    timeErrorSeconds <= tolerance.maxEpochSeconds;
  return {
    status: within ? 'WITHIN_DECLARED_TOLERANCE_EXPERIMENTAL' : 'OUTSIDE_DECLARED_TOLERANCE',
    bodyCount: BODIES.length,
    maxDirectionArcsec, maxDistancePpm, maxEpochSeconds: timeErrorSeconds,
    scientificallyValidated: false,
  };
}

function invalidFile() { throw new Error('REFERENCE_AUDIT: unsafe or invalid local file'); }
/** Reject symlinks, oversize JSONs, and replaced files without exposing paths. */
async function readSmallJson(path, maxBytes = 128 * 1024) {
  let link; try { link = await lstat(path, {bigint:true}); } catch { invalidFile(); }
  if (!link.isFile() || link.isSymbolicLink() || link.size === 0n || link.size > BigInt(maxBytes)) invalidFile();
  let file; try { file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch { invalidFile(); }
  try {
    const stat = await file.stat({bigint:true});
    if (stat.dev !== link.dev || stat.ino !== link.ino || stat.size !== link.size) invalidFile();
    const bytes = Buffer.alloc(Number(stat.size));
    let read = 0;
    while (read < bytes.length) {
      const {bytesRead} = await file.read(bytes, read, bytes.length - read, read);
      if (!bytesRead) invalidFile();
      read += bytesRead;
    }
    const after = await file.stat({bigint:true});
    if (after.size !== stat.size || after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs) invalidFile();
    try { return JSON.parse(bytes.toString('utf8')); } catch { invalidFile(); }
  } finally { await file.close(); }
}

/** Hash a separately saved original reference response with constant-size memory. */
async function hashRawSource(path) {
  let link; try { link = await lstat(path, {bigint:true}); } catch { invalidFile(); }
  if (!link.isFile() || link.isSymbolicLink() || link.size === 0n || link.size > 32n * 1024n * 1024n) invalidFile();
  let file; try { file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch { invalidFile(); }
  try {
    const stat = await file.stat({bigint:true});
    if (stat.dev !== link.dev || stat.ino !== link.ino || stat.size !== link.size) invalidFile();
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(READ_BLOCK);
    let offset = 0;
    while (offset < Number(stat.size)) {
      const {bytesRead} = await file.read(buffer, 0, Math.min(READ_BLOCK, Number(stat.size) - offset), offset);
      if (!bytesRead) invalidFile();
      hash.update(buffer.subarray(0,bytesRead)); offset += bytesRead;
    }
    const after = await file.stat({bigint:true});
    if (after.size !== stat.size || after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs) invalidFile();
    return hash.digest('hex');
  } finally { await file.close(); }
}

export function parseComparisonArgs(args) {
  const keys = ['--actual','--reference','--raw-source','--max-direction-arcsec','--max-distance-ppm','--max-epoch-seconds'];
  if (!Array.isArray(args) || args.length !== 12) return null;
  const items = Object.create(null);
  for (let i=0;i<args.length;i+=2) {
    if (!keys.includes(args[i]) || Object.hasOwn(items,args[i]) ||
        typeof args[i+1] !== 'string' || !args[i+1] || args[i+1].startsWith('--')) return null;
    items[args[i]] = args[i+1];
  }
  for (const key of keys.slice(3)) if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(items[key])) return null;
  const tolerance = {
    maxDirectionArcsec: Number(items['--max-direction-arcsec']),
    maxDistancePpm: Number(items['--max-distance-ppm']),
    maxEpochSeconds: Number(items['--max-epoch-seconds']),
  };
  if (!validTolerance(tolerance)) return null;
  return { actual:items['--actual'], reference:items['--reference'], rawSource:items['--raw-source'], tolerance };
}

export async function auditLocalReference(paths, tolerance) {
  const [actual,reference,digest] = await Promise.all([
    readSmallJson(paths.actual), readSmallJson(paths.reference), hashRawSource(paths.rawSource),
  ]);
  return compareExperimentalSky(actual,reference,digest,tolerance);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseComparisonArgs(process.argv.slice(2));
    if (!options) throw new Error('bad arguments');
    const report = await auditLocalReference(options, options.tolerance);
    // No source names, observer, timestamps, raw data or file paths are printed.
    console.log('REFERENCE_AUDIT:' + report.status);
    if (report.status !== 'INCOMPARABLE') {
      console.log('Bodies: ' + report.bodyCount + '; max angular arcsec: ' + report.maxDirectionArcsec.toFixed(6) +
        '; max distance ppm: ' + report.maxDistancePpm.toFixed(6) +
        '; max epoch seconds: ' + report.maxEpochSeconds.toFixed(6));
    }
    console.log('EXPLORE ONLY: agreement is NOT independent certification of science, provenance, or end-user charts.');
    if (report.status !== 'WITHIN_DECLARED_TOLERANCE_EXPERIMENTAL') process.exitCode = 1;
  } catch {
    console.error('REFERENCE_AUDIT:INVALID_INPUT_OR_LOCAL_FILE');
    process.exitCode = 1;
  }
}
