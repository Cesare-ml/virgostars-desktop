/**
 * Verify the saved raw response, query and normalizer source used for a
 * separately reviewed astronomical reference. Byte identity is NOT scientific
 * independence, JPL authenticity, or permission to render a chart.
 */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA256 = /^[a-f0-9]{64}$/;
const CHUNK_BYTES = 1024 * 1024;
const CAPS = Object.freeze({
  reference: 128 * 1024,
  rawSource: 32 * 1024 * 1024,
  rawQuery: 128 * 1024,
  normalizerSource: 1024 * 1024,
});
const KEYS = Object.freeze(['--reference', '--raw-source', '--raw-query', '--normalizer-source']);
const META_KEYS = Object.freeze(['source', 'rawResponseSha256', 'querySha256',
  'normalizationCodeSha256', 'normalizationNotes']);

function reject(reason) { return Object.freeze({status:'EVIDENCE_REJECTED', reason}); }
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).length === allowed.length &&
    Object.keys(value).every(key => allowed.includes(key));
}

// Use O_NOFOLLOW where available, but also compare lstat and fstat file identity.
// Errors are intentionally sanitized: never print birth data or local paths.
export async function inspectFile(path, maximum, keepBytes = false) {
  if (typeof path !== 'string' || path.length === 0 || path.length > 4096) throw Error('UNSAFE_FILE');
  let before;
  try { before = await lstat(path, {bigint:true}); }
  catch { throw Error('UNSAFE_FILE'); }
  if (!before.isFile() || before.isSymbolicLink() || before.size === 0n ||
      before.size > BigInt(maximum)) throw Error('UNSAFE_FILE');
  let handle;
  try { handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)); }
  catch { throw Error('UNSAFE_FILE'); }
  try {
    const current = await handle.stat({bigint:true});
    if (!current.isFile() || current.dev !== before.dev || current.ino !== before.ino ||
        current.size !== before.size || current.mtimeNs !== before.mtimeNs ||
        current.ctimeNs !== before.ctimeNs) throw Error('UNSAFE_FILE');
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, maximum));
    const collected = keepBytes ? [] : null;
    let offset = 0;
    const total = Number(current.size);
    while (offset < total) {
      const length = Math.min(buffer.length, total - offset);
      const {bytesRead} = await handle.read(buffer, 0, length, offset);
      if (!bytesRead) throw Error('UNSAFE_FILE');
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      if (collected) collected.push(Buffer.from(chunk));
      offset += bytesRead;
    }
    // Detect a stream that appended data beyond its original declared size.
    const extra = await handle.read(buffer, 0, 1, total);
    if (extra.bytesRead !== 0) throw Error('UNSAFE_FILE');
    const after = await handle.stat({bigint:true});
    const pathAfter = await lstat(path, {bigint:true});
    if (!pathAfter.isFile() || after.dev !== current.dev ||
        after.ino !== current.ino || after.size !== current.size ||
        after.mtimeNs !== current.mtimeNs || after.ctimeNs !== current.ctimeNs ||
        pathAfter.dev !== current.dev || pathAfter.ino !== current.ino ||
        pathAfter.size !== current.size || pathAfter.mtimeNs !== current.mtimeNs ||
        pathAfter.ctimeNs !== current.ctimeNs) throw Error('UNSAFE_FILE');
    return {
      digest:hash.digest('hex'),
      identity:String(current.dev) + ':' + String(current.ino),
      ...(collected ? {bytes:Buffer.concat(collected)} : {}),
    };
  } finally { await handle.close(); }
}

/**
 * All paths remain local. Returned result has fixed codes and no file data.
 * The independently reviewed query + conversion source must be preserved.
 */
export async function verifyReferenceEvidence(paths) {
  if (!isRecord(paths) || !exactKeys(paths, Object.keys(CAPS))) return reject('INVALID_INPUT');
  let files;
  try {
    files = await Promise.all(Object.entries(CAPS).map(async ([key, cap]) =>
      [key, await inspectFile(paths[key], cap, key === 'reference')]));
  } catch { return reject('UNSAFE_FILE'); }
  return validateCapturedEvidence(Object.fromEntries(files));
}

/**
 * Reuse the exact D-05 source provenance rules without reopening files.
 * Internal review-only helper, never for IPC or browser payloads.
 */
export function validateCapturedEvidence(evidence) {
  if (!evidence || !Object.values(evidence).every(file => file?.identity && typeof file.digest === 'string') ||
      new Set(Object.values(evidence).map(file => file.identity)).size !== 4) {
    return reject('REUSED_FILE');
  }
  let reference;
  try { reference = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(evidence.reference.bytes)); }
  catch { return reject('INVALID_REFERENCE'); }
  const provenance = reference?.provenance;
  if (!exactKeys(provenance, META_KEYS) || provenance.source !== 'JPL_HORIZONS' ||
      !SHA256.test(provenance.rawResponseSha256) ||
      !SHA256.test(provenance.querySha256) ||
      !SHA256.test(provenance.normalizationCodeSha256) ||
      typeof provenance.normalizationNotes !== 'string' ||
      provenance.normalizationNotes.length < 20 || provenance.normalizationNotes.length > 400 ||
      !/^[\x20-\x7e]+$/.test(provenance.normalizationNotes)) {
    return reject('INVALID_PROVENANCE');
  }
  if (evidence.rawSource.digest !== provenance.rawResponseSha256 ||
      evidence.rawQuery.digest !== provenance.querySha256 ||
      evidence.normalizerSource.digest !== provenance.normalizationCodeSha256) {
    return reject('EVIDENCE_DIGEST_MISMATCH');
  }
  return Object.freeze({
    status:'EVIDENCE_BYTES_MATCH',
    // Used only for within-run consistency. Never printed by the CLI.
    referenceSha256:evidence.reference.digest,
    scientificallyValidated:false,
    sourceAuthenticated:false,
    normalizationReviewed:false,
  });
}

/**
 * Fingerprint the exact experimental snapshot bytes for within-run integrity.
 * This does not inspect scientific content: the numeric comparator owns that.
 * The private SHA-256 is never printed by the CLI.
 */
export async function fingerprintExperimentalSnapshot(path) {
  try {
    const inspected = await inspectFile(path, CAPS.reference);
    return Object.freeze({status:'SNAPSHOT_FINGERPRINTED', sha256:inspected.digest});
  } catch {
    return Object.freeze({status:'SNAPSHOT_REJECTED'});
  }
}

export function parseEvidenceArgs(args) {
  if (!Array.isArray(args) || args.length !== KEYS.length * 2) return null;
  const values = Object.create(null);
  for (let i=0; i<args.length; i+=2) {
    if (!KEYS.includes(args[i]) || Object.hasOwn(values, args[i]) ||
        typeof args[i+1] !== 'string' || !args[i+1] || args[i+1].startsWith('--')) return null;
    values[args[i]] = args[i+1];
  }
  return KEYS.every(key => values[key]) ? {
    reference:values['--reference'], rawSource:values['--raw-source'],
    rawQuery:values['--raw-query'], normalizerSource:values['--normalizer-source'],
  } : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const paths = parseEvidenceArgs(process.argv.slice(2));
  const result = paths ? await verifyReferenceEvidence(paths) : reject('INVALID_INPUT');
  console.log('REFERENCE_EVIDENCE:' + result.status);
  if (result.status !== 'EVIDENCE_BYTES_MATCH') {
    console.error('REFERENCE_EVIDENCE:' + result.reason);
    process.exitCode = 1;
  } else {
    console.log('Hash agreement only; no JPL authentication, independent reduction or numerical validation.');
  }
}
