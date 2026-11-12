/**
 * Bound the manual D-06 evidence/numerical audit to one unchanged experimental
 * sky JSON byte stream. This is a file-integrity check, NOT scientific proof.
 */
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';

const MAX_BYTES = 128 * 1024;
const BLOCK_BYTES = 16 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) |
  (constants.O_NONBLOCK ?? 0);
const REASONS = new Set([
  'INVALID_ARGUMENTS', 'INVALID_OPERATIONS', 'EVIDENCE_REJECTED',
  'COMPARISON_INVALID', 'EVIDENCE_CHANGED', 'REVIEW_UNAVAILABLE',
]);
const blocked = reason => Object.freeze({
  status:'REVIEW_BLOCKED', reason, scientificallyValidated:false,
});

function sameFile(a,b) {
  return a.dev===b.dev && a.ino===b.ino && a.size===b.size &&
    a.mtimeNs===b.mtimeNs && a.ctimeNs===b.ctimeNs;
}

/**
 * Hash no more than 128 KiB from an operator-chosen regular JSON file.
 * Invalid, changing, unreadable or special files return null. Never print paths
 * or read the contents into application state. On some OSes NOFOLLOW/NONBLOCK
 * are unavailable; the lstat/fstat checks are best-effort race defense.
 */
export async function fingerprintActualSkyFile(path) {
  if (typeof path!=='string' || path.length===0 || path.length>4096 ||
      /[\x00-\x1f\x7f]/.test(path)) return null;
  let fd;
  try {
    const pathBefore=await lstat(path,{bigint:true});
    if (!pathBefore.isFile() || pathBefore.size<2n ||
        pathBefore.size>BigInt(MAX_BYTES)) return null;
    fd=await open(path,FLAGS);
    const before=await fd.stat({bigint:true});
    if (!before.isFile() || !sameFile(pathBefore,before)) return null;
    const hash=createHash('sha256');
    const buffer=Buffer.allocUnsafe(BLOCK_BYTES);
    const size=Number(before.size);
    let position=0;
    while (position<size) {
      const n=Math.min(buffer.length,size-position);
      const {bytesRead}=await fd.read(buffer,0,n,position);
      if (!bytesRead) return null;
      hash.update(buffer.subarray(0,bytesRead));
      position+=bytesRead;
    }
    // Detect appended bytes even if the metadata observation is delayed.
    const extra=await fd.read(buffer,0,1,size);
    if (extra.bytesRead!==0) return null;
    const after=await fd.stat({bigint:true});
    const pathAfter=await lstat(path,{bigint:true});
    if (!pathAfter.isFile() || !sameFile(before,after) ||
        !sameFile(pathBefore,pathAfter)) return null;
    return hash.digest('hex');
  } catch { return null; }
  finally { if (fd) { try {await fd.close();} catch {} } }
}

/**
 * Used by the actual manual CLI. A changing experimental snapshot blocks the
 * review even if evidence and numerical comparison independently passed.
 * The injected fingerprint function is for synthetic unit tests only.
 */
export async function guardActualSnapshotDuringReview(parsed,review,options={}) {
  const path=parsed?.comparison?.actual;
  if (typeof path!=='string' || !path || typeof review!=='function') {
    return blocked('INVALID_ARGUMENTS');
  }
  const fingerprint=options.fingerprint ?? fingerprintActualSkyFile;
  if (typeof fingerprint!=='function') return blocked('INVALID_OPERATIONS');
  try {
    const before=await fingerprint(path);
    if (typeof before!=='string' || !SHA256.test(before)) return blocked('ACTUAL_UNAVAILABLE');
    const result=await review();
    const after=await fingerprint(path);
    if (typeof after!=='string' || !SHA256.test(after)) return blocked('ACTUAL_UNAVAILABLE');
    if (before!==after) return blocked('ACTUAL_CHANGED');
    if (result?.status==='REVIEW_BLOCKED') {
      return blocked(REASONS.has(result.reason)?result.reason:'REVIEW_INVALID');
    }
    if (!['REVIEW_WITHIN_TOLERANCE_EXPERIMENTAL','REVIEW_OUTSIDE_TOLERANCE_EXPERIMENTAL']
      .includes(result?.status) || result.scientificallyValidated!==false ||
      !['maxDirectionArcsec','maxDistancePpm','maxEpochSeconds'].every(k=>
        typeof result[k]==='number' && Number.isFinite(result[k]) && result[k]>=0)) {
      return blocked('REVIEW_INVALID');
    }
    // Project only safe fixed metrics. No raw data or file path can leak.
    return Object.freeze({
      status:result.status,
      maxDirectionArcsec:result.maxDirectionArcsec,
      maxDistancePpm:result.maxDistancePpm,
      maxEpochSeconds:result.maxEpochSeconds,
      scientificallyValidated:false,
    });
  } catch { return blocked('REVIEW_UNAVAILABLE'); }
}
