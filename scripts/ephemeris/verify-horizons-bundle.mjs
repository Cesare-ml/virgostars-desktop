/**
 * Offline integrity review for ten original NASA/JPL Horizons-style responses.
 * No network requests, astronomy, source authentication or chart readiness.
 * Reuses the exact query plan and vector parser of the acquisition module.
 */
import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLocalPlan, parseHorizonsVectorResponse, validateCanonicalPlan,
  parseAcquisitionArgs } from './acquire-horizons-vectors.mjs';

const HASH = /^[a-f0-9]{64}$/;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sameKeys = (value, keys) => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.keys(value).length === keys.length &&
  Object.keys(value).every(k => keys.includes(k));
const MANIFEST_KEYS = ['schemaVersion','status','tdbJulianDay','frame','origin','responseCount','responses'];
const RESPONSE_KEYS = ['bodyId','naifId','responseFilename','queryUrlSha256',
  'originalResponseSha256','sourceClaim'];

function parseJson(bytes) {
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
function reject(reason) {
  return Object.freeze({status:'BUNDLE_REJECTED',reason,scientificallyValidated:false});
}

/** Always returns sanitized fixed codes. Can be used completely offline. */
export async function verifyHorizonsBundle(planPath, outputDirectory) {
  if (typeof planPath !== 'string' || !planPath || typeof outputDirectory !== 'string' ||
      !outputDirectory || outputDirectory.length > 4096 || /[\x00-\x1f\x7f]/.test(outputDirectory)) {
    return reject('INVALID_ARGUMENTS');
  }
  let plan, manifest, names;
  try {
    plan=validateCanonicalPlan(parseJson(await readLocalPlan(planPath)));
    if (!plan) return reject('NONCANONICAL_PLAN');
    const dir = await lstat(outputDirectory);
    if (!dir.isDirectory() || dir.isSymbolicLink()) return reject('UNSAFE_OUTPUT_DIRECTORY');
    names = await readdir(outputDirectory);
    manifest = parseJson(await readLocalPlan(join(outputDirectory,'response-manifest.json'),MAX_MANIFEST_BYTES));
  } catch { return reject('INVALID_OR_UNSAFE_BUNDLE'); }
  if (!sameKeys(manifest,MANIFEST_KEYS) || manifest.schemaVersion !== 1 ||
      manifest.status !== 'STRUCTURE_CHECKED_NOT_AUTHENTICATED' ||
      manifest.tdbJulianDay !== plan.tdbJulianDay ||
      manifest.frame !== plan.frame || manifest.origin !== plan.origin ||
      manifest.responseCount !== 10 || !Array.isArray(manifest.responses) ||
      manifest.responses.length !== 10) return reject('MANIFEST_MISMATCH');
  const expectedNames = ['response-manifest.json',...plan.requests.map(r=>r.responseFilename)];
  if (names.length !== expectedNames.length ||
      names.some(name=>!expectedNames.includes(name))) return reject('UNEXPECTED_FILE');

  for (let i=0;i<plan.requests.length;i++) {
    const expected=plan.requests[i], record=manifest.responses[i];
    if (!sameKeys(record,RESPONSE_KEYS) ||
        record.bodyId !== expected.bodyId || record.naifId !== expected.naifId ||
        record.responseFilename !== expected.responseFilename ||
        !HASH.test(record.queryUrlSha256) || !HASH.test(record.originalResponseSha256) ||
        record.queryUrlSha256 !== digest(Buffer.from(expected.url,'utf8')) ||
        !(record.sourceClaim === null ||
          (typeof record.sourceClaim === 'string' && /^[A-Za-z0-9._+\-]{1,64}$/.test(record.sourceClaim)))) {
      return reject('MANIFEST_MISMATCH');
    }
    let responseBytes, parsed;
    try {
      responseBytes = await readLocalPlan(join(outputDirectory,expected.responseFilename),MAX_RESPONSE_BYTES);
      if (digest(responseBytes)!==record.originalResponseSha256) return reject('RESPONSE_DIGEST_MISMATCH');
      const raw = new TextDecoder('utf-8',{fatal:true}).decode(responseBytes);
      parsed = parseHorizonsVectorResponse(raw,{...expected,tdbJulianDay:plan.tdbJulianDay});
    } catch { return reject('INVALID_OR_UNSAFE_RESPONSE'); }
    if (parsed.status !== 'PARSED_VECTOR_UNAUTHENTICATED' ||
        parsed.sourceClaim !== record.sourceClaim || parsed.scientificallyValidated !== false) {
      return reject('MANIFEST_MISMATCH');
    }
  }
  return Object.freeze({status:'BUNDLE_INTEGRITY_OK_UNAUTHENTICATED',count:10,
    scientificallyValidated:false,sourceAuthenticated:false});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseAcquisitionArgs(process.argv.slice(2));
  const report = args ? await verifyHorizonsBundle(args.planPath,args.outputDirectory) : reject('INVALID_ARGUMENTS');
  process.stdout.write('HORIZONS_BUNDLE:'+report.status+'\n');
  if (report.status === 'BUNDLE_REJECTED') {
    process.stderr.write('HORIZONS_BUNDLE:'+report.reason+'\n');
    process.exitCode=1;
  } else process.stdout.write('Local bytes match the manifest; source authenticity and astronomy remain unverified.\n');
}
