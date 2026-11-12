/**
 * Offline campaign of geometric DE441 reference comparisons.
 * All comparisons are experimental review ONLY; no astronomical computation.
 */
import {compareExperimentalToReference} from './de441-reference-check.mjs';

const KEYS = ['schemaVersion', 'cases'];
const CASE_KEYS = ['id', 'utcIso', 'latMicro', 'lngMicro', 'heightMeters', 'actualFile', 'referenceFile'];
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\.json$/;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const exact = (x, names) => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  Object.keys(x).length === names.length && Object.keys(x).every(key => names.includes(key));
const validUtc = x => {
  if (typeof x !== 'string' || !UTC.test(x)) return false;
  const epoch = Date.parse(x);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === x &&
    epoch >= Date.UTC(1972, 0, 1) && epoch < Date.UTC(2027, 5, 28);
};
const siteKey = c => String(c.latMicro)+':'+c.lngMicro+':'+c.heightMeters;
const caseKey = c => c.utcIso+':'+siteKey(c);

/** Require an actual multi-epoch and multi-site *declared* experiment. */
export function validReferenceCampaign(manifest) {
  if (!exact(manifest, KEYS) || manifest.schemaVersion !== 1 ||
      !Array.isArray(manifest.cases) || manifest.cases.length < 4 || manifest.cases.length > 24) return false;
  const ids = new Set(), caseKeys = new Set(), sites = new Set(), dates = new Set();
  for (const c of manifest.cases) {
    if (!exact(c, CASE_KEYS) || typeof c.id !== 'string' || !SAFE_ID.test(c.id) ||
        !validUtc(c.utcIso) || !Number.isSafeInteger(c.latMicro) ||
        !Number.isSafeInteger(c.lngMicro) || Math.abs(c.latMicro) > 90_000_000 ||
        Math.abs(c.lngMicro) > 180_000_000 ||
        typeof c.heightMeters !== 'number' || !Number.isFinite(c.heightMeters) ||
        c.heightMeters < -12000 || c.heightMeters > 100000 ||
        typeof c.actualFile !== 'string' || !SAFE_FILE.test(c.actualFile) ||
        typeof c.referenceFile !== 'string' || !SAFE_FILE.test(c.referenceFile) ||
        c.actualFile === c.referenceFile || ids.has(c.id) || caseKeys.has(caseKey(c))) return false;
    ids.add(c.id);caseKeys.add(caseKey(c));sites.add(siteKey(c));dates.add(c.utcIso.slice(0,10));
  }
  return dates.size >= 2 && sites.size >= 2;
}

/**
 * All comparisons run sequentially to bound memory and I/O.
 * readJson receives a strictly validated basename, NOT a path from an arbitrary location.
 * The manifest metadata is verified against the actual computed sky data, so a
 * fictional manifest cannot fake seasonal or location coverage of different files.
 */
export async function runReferenceCampaign(manifest, readJson) {
  if (!validReferenceCampaign(manifest) || typeof readJson !== 'function') {
    return {kind:'invalid_campaign',checked:0,failed:0};
  }
  let checked=0, failed=0;
  for (const item of manifest.cases) {
    checked++;
    let actual, reference;
    try {
      actual = await readJson(item.actualFile);
      reference = await readJson(item.referenceFile);
    } catch {
      failed++;continue;
    }
    if (!actual || actual.utcIso !== item.utcIso || actual.latMicro !== item.latMicro ||
        actual.lngMicro !== item.lngMicro || actual.heightMeters !== item.heightMeters ||
        compareExperimentalToReference(actual, reference).kind !== 'within_provisional_tolerance') {
      failed++;
    }
  }
  return {kind:failed ? 'campaign_failed' : 'all_within_provisional_tolerance',checked,failed};
}
