/**
 * Offline review of one captured set of input bytes. All five files are read
 * exactly once; the numerical comparator receives only the captured JSON,
 * never independently reopened filesystem paths.
 * A byte-consistent bundle is NOT authenticated JPL astronomy or chart-ready.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectFile, validateCapturedEvidence } from './verify-reference-evidence.mjs';
import { parseVerifiedAuditArgs } from './run-verified-de441-audit.mjs';
import { compareExperimentalSky } from './compare-de441-reference.mjs';

const SOURCES = Object.freeze([
  ['actual', 128 * 1024, true],
  ['reference', 128 * 1024, true],
  ['rawSource', 32 * 1024 * 1024, false],
  ['rawQuery', 128 * 1024, false],
  ['normalizerSource', 1024 * 1024, false],
]);
const blocked = reason => Object.freeze({status:'CAPTURED_AUDIT_BLOCKED',reason,scientificallyValidated:false});

function parseJson(bytes) {
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
function sanitizeResult(review) {
  if (!review || review.scientificallyValidated !== false || review.bodyCount !== 10 ||
      !['WITHIN_DECLARED_TOLERANCE_EXPERIMENTAL','OUTSIDE_DECLARED_TOLERANCE'].includes(review.status) ||
      !['maxDirectionArcsec','maxDistancePpm','maxEpochSeconds'].every(k=>
        typeof review[k] === 'number' && Number.isFinite(review[k]) && review[k] >= 0)) {
    return blocked('COMPARISON_INVALID');
  }
  return Object.freeze({
    status:review.status === 'WITHIN_DECLARED_TOLERANCE_EXPERIMENTAL'
      ? 'CAPTURED_WITHIN_TOLERANCE_EXPERIMENTAL' : 'CAPTURED_OUTSIDE_TOLERANCE_EXPERIMENTAL',
    maxDirectionArcsec:review.maxDirectionArcsec,
    maxDistancePpm:review.maxDistancePpm,
    maxEpochSeconds:review.maxEpochSeconds,
    scientificallyValidated:false,
  });
}

/**
 * A separate full-set atomic transaction is NOT claimed. Source file handles
 * may observe different moments, but every numerical value is taken from the
 * exact bytes validated and hashed during this single capture pass.
 */
export async function runCapturedDe441Audit(parsed) {
  if (!parsed || typeof parsed !== 'object' || !parsed.evidence || !parsed.comparison ||
      parsed.evidence.reference !== parsed.comparison.reference ||
      parsed.evidence.rawSource !== parsed.comparison.rawSource) return blocked('INVALID_ARGUMENTS');
  const paths={actual:parsed.comparison.actual,...parsed.evidence};
  let captured;
  try {
    // Deliberately sequential to keep simultaneous opened handles bounded.
    captured=Object.create(null);
    for(const [key,maxBytes,keepBytes] of SOURCES) {
      captured[key]=await inspectFile(paths[key],maxBytes,keepBytes);
    }
  } catch { return blocked('UNSAFE_INPUT_FILE'); }
  if (new Set(SOURCES.map(([key])=>captured[key].identity)).size !== SOURCES.length) {
    return blocked('REUSED_INPUT_FILE');
  }
  const evidence=validateCapturedEvidence({
    reference:captured.reference,
    rawSource:captured.rawSource,
    rawQuery:captured.rawQuery,
    normalizerSource:captured.normalizerSource,
  });
  if (evidence.status !== 'EVIDENCE_BYTES_MATCH' ||
      evidence.referenceSha256 !== captured.reference.digest) return blocked('EVIDENCE_REJECTED');
  let actual,reference;
  try {
    actual=parseJson(captured.actual.bytes);
    reference=parseJson(captured.reference.bytes);
  } catch { return blocked('INVALID_JSON'); }
  // Pure and synchronous: there is no file access between hash verification
  // and the numerical comparison; all objects are private to this call.
  return sanitizeResult(compareExperimentalSky(actual,reference,captured.rawSource.digest,
    parsed.comparison.tolerance));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const parsed=parseVerifiedAuditArgs(process.argv.slice(2));
  const result=await runCapturedDe441Audit(parsed);
  console.log('CAPTURED_DE441_AUDIT:'+result.status);
  if (result.status==='CAPTURED_AUDIT_BLOCKED') console.error('CAPTURED_DE441_AUDIT:'+result.reason);
  else console.log('Maximum differences: '+result.maxDirectionArcsec.toFixed(6)+' arcsec, '+
    result.maxDistancePpm.toFixed(6)+' ppm, '+result.maxEpochSeconds.toFixed(6)+' seconds');
  console.log('EXPERIMENTAL REVIEW ONLY: neither source authenticity nor astronomical accuracy is certified.');
  if (result.status!=='CAPTURED_WITHIN_TOLERANCE_EXPERIMENTAL') process.exitCode=1;
}
