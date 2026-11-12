/** Offline D-06 verified audit orchestrator. NO astronomy or production readiness. */
const CAMPAIGN_KEYS = ['schemaVersion', 'tolerances', 'cases'];
const CASE_KEYS = ['id', 'utcIso', 'latMicro', 'lngMicro', 'heightMeters',
  'actualFile', 'referenceFile', 'rawSourceFile', 'rawQueryFile', 'normalizerFile'];
const TOLERANCE_KEYS = ['maxDirectionArcsec', 'maxDistancePpm', 'maxEpochSeconds'];
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SAFE_BASENAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,94}\.(?:json|txt|py|mjs)$/i;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const HASH = /^[a-f0-9]{64}$/;
const RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => record(x) && Object.keys(x).length === keys.length &&
  Object.keys(x).every(k => keys.includes(k));
const goodName = name => typeof name === 'string' && SAFE_BASENAME.test(name) &&
  !RESERVED.test(name) && !name.includes('..');
const siteKey = c => c.latMicro+':'+c.lngMicro+':'+c.heightMeters;
function validUtc(s) {
  if (typeof s !== 'string' || !UTC.test(s)) return false;
  const epoch = Date.parse(s);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === s &&
    epoch >= Date.UTC(1972, 0, 1) && epoch < Date.UTC(2027, 5, 28);
}
export function validVerifiedCampaign(manifest) {
  if (!exact(manifest, CAMPAIGN_KEYS) || manifest.schemaVersion !== 1 ||
      !exact(manifest.tolerances, TOLERANCE_KEYS) ||
      ![3600, 1_000_000, 1].every((limit, i) => {
        const value = manifest.tolerances[TOLERANCE_KEYS[i]];
        return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= limit;
      }) || !Array.isArray(manifest.cases) ||
      manifest.cases.length < 4 || manifest.cases.length > 24) return false;
  const seenIds = new Set(), seenSitesAndTimes = new Set();
  const independentFiles = new Set(), normalizerFiles = new Set();
  const sitesByDay = new Map();
  for (const c of manifest.cases) {
    if (!exact(c, CASE_KEYS) || typeof c.id !== 'string' || !SAFE_ID.test(c.id) ||
        seenIds.has(c.id.toLowerCase()) || !validUtc(c.utcIso) ||
        !Number.isSafeInteger(c.latMicro) || Math.abs(c.latMicro) > 90_000_000 ||
        !Number.isSafeInteger(c.lngMicro) || Math.abs(c.lngMicro) > 180_000_000 ||
        typeof c.heightMeters !== 'number' || !Number.isFinite(c.heightMeters) ||
        c.heightMeters < -12000 || c.heightMeters > 100000) return false;
    const names = [c.actualFile, c.referenceFile, c.rawSourceFile, c.rawQueryFile, c.normalizerFile];
    if (!names.every(goodName) || !/\.json$/i.test(c.actualFile) ||
        !/\.json$/i.test(c.referenceFile) || new Set(names.map(n => n.toLowerCase())).size !== 5) return false;
    const independent = names.slice(0, 4).map(n => n.toLowerCase());
    if (independent.some(n => independentFiles.has(n) || normalizerFiles.has(n))) return false;
    if (independentFiles.has(names[4].toLowerCase())) return false;
    independent.forEach(n => independentFiles.add(n));
    normalizerFiles.add(names[4].toLowerCase()); // same normalizer may be reused intentionally
    const key = c.utcIso + ':' + siteKey(c);
    if (seenSitesAndTimes.has(key)) return false;
    seenIds.add(c.id.toLowerCase());
    seenSitesAndTimes.add(key);
    const day = c.utcIso.slice(0,10);
    if (!sitesByDay.has(day)) sitesByDay.set(day, new Set());
    sitesByDay.get(day).add(siteKey(c));
  }
  // Both distinct sites must be observed on both dates (crossed 2 x 2).
  const days = [...sitesByDay.values()];
  for (let i=0; i<days.length; i++) for(let j=i+1; j<days.length; j++) {
    let shared = 0;
    for(const site of days[i]) if(days[j].has(site) && ++shared >= 2) return true;
  }
  return false;
}

const failedCampaign = (checked, failed, blocked, outside) => Object.freeze({
  status: failed ? 'CAMPAIGN_FAILED' : 'PROVISIONAL_ALL_WITHIN',
  checked, failed, blocked, outside, scientificallyValidated:false,
});
/**
 * Sequentially invokes the EXISTING D-06 evidence+geometry audit for every case.
 * readActual returns only UTC/site and SHA-256 from ONE safe opened file.
 * A post-audit re-read must match the initial SHA-256 and declared metadata.
 * Dependency injection allows synthetic tests; the CLI supplies real D-06.
 */
export async function runVerifiedCampaign(manifest, operations = {}) {
  const {readActual, auditCase} = record(operations) ? operations : {};
  if (!validVerifiedCampaign(manifest) || typeof readActual !== 'function' ||
      typeof auditCase !== 'function') {
    return Object.freeze({status:'INVALID_CAMPAIGN',checked:0,failed:0,
      blocked:0,outside:0,scientificallyValidated:false});
  }
  let checked=0, blocked=0, outside=0;
  for (const item of manifest.cases) {
    checked++;
    try {
      const before = await readActual(item.actualFile);
      if (!record(before) || !HASH.test(before.sha256) ||
          before.utcIso !== item.utcIso || before.latMicro !== item.latMicro ||
          before.lngMicro !== item.lngMicro || before.heightMeters !== item.heightMeters) {
        blocked++;continue;
      }
      const report = await auditCase(item, manifest.tolerances);
      const after = await readActual(item.actualFile);
      if (!record(after) || after.sha256 !== before.sha256 ||
          after.utcIso !== before.utcIso || after.latMicro !== before.latMicro ||
          after.lngMicro !== before.lngMicro || after.heightMeters !== before.heightMeters) {
        blocked++;continue;
      }
      if (report?.scientificallyValidated !== false) {blocked++;continue;}
      const metrics = TOLERANCE_KEYS.map(key => report[key]);
      if (!metrics.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) {
        blocked++;continue;
      }
      const within = metrics.every((value, i) => value <= manifest.tolerances[TOLERANCE_KEYS[i]]);
      if (report.status === 'REVIEW_OUTSIDE_TOLERANCE_EXPERIMENTAL' && !within) {
        outside++;continue;
      }
      if (report.status !== 'REVIEW_WITHIN_TOLERANCE_EXPERIMENTAL' || !within) {
        blocked++;continue;
      }
    } catch {
      blocked++; // never expose a raw exception, partial input, location or file name
    }
  }
  return failedCampaign(checked, blocked+outside, blocked, outside);
}
