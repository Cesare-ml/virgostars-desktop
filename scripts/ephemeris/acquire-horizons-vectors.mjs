/**
 * Explicit opt-in, bounded NASA/JPL Horizons request acquisition.
 * The response header is a SELF-CLAIM, not independent source authentication.
 * Never exports astronomical coordinates as validated chart positions.
 */
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, open, mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHorizonsVectorPlan } from './prepare-horizons-vector-plan.mjs';
import { parseUniqueHorizonsHeaders } from './strict-horizons-headers.mjs';
import { recordNewDirectory, recordCreatedFile, cleanupOnlyOwnedFiles } from './rollback-horizons-directory.mjs';

const MAX_PLAN_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_WAIT_MS = 20000;
const DEFAULT_PAUSE_MS = 2500;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function fail(code) { throw new Error(code); }
const verify = (condition, code) => { if (!condition) fail(code); };

/** Read a small regular local file once, refusing symlinks and detectable changes. */
export async function readLocalPlan(path, maxBytes = MAX_PLAN_BYTES) {
  let before, handle;
  try {
    before = await lstat(path, { bigint: true });
    verify(before.isFile() && !before.isSymbolicLink() && before.size > 0n &&
      before.size <= BigInt(maxBytes), 'INVALID_PLAN');
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0));
    const current = await handle.stat({ bigint: true });
    verify(current.isFile() && current.dev === before.dev && current.ino === before.ino &&
      current.size === before.size && current.mtimeNs === before.mtimeNs &&
      current.ctimeNs === before.ctimeNs, 'INVALID_PLAN');
    const buffer = Buffer.alloc(Number(current.size));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      verify(bytesRead > 0, 'INVALID_PLAN');
      offset += bytesRead;
    }
    const end = await handle.stat({ bigint: true });
    const pathEnd = await lstat(path, { bigint: true });
    verify([end, pathEnd].every(s => s.isFile() && s.dev === current.dev &&
      s.ino === current.ino && s.size === current.size &&
      s.mtimeNs === current.mtimeNs && s.ctimeNs === current.ctimeNs), 'INVALID_PLAN');
    return buffer;
  } catch { fail('INVALID_PLAN'); }
  finally { if (handle) await handle.close(); }
}

/** The operator's plan MUST match a plan that the pinned D-10 generator creates. */
export function validateCanonicalPlan(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  try {
    const expected = buildHorizonsVectorPlan(candidate.tdbJulianDay);
    return JSON.stringify(candidate) === JSON.stringify(expected) ? expected : null;
  } catch { return null; }
}

/** Parse only a single JDTDB Cartesian row; no transformations or interpolation. */
export function parseHorizonsVectorResponse(raw, expected) {
  verify(typeof raw === 'string' && Buffer.byteLength(raw, 'utf8') <= MAX_RESPONSE_BYTES,
    'INVALID_RESPONSE');
  verify(expected && typeof expected.naifId === 'string', 'INVALID_RESPONSE');
  // Official Horizons text API includes these two transport-format headers.
  // The API manual v1.3 still documents wire-format API VERSION 1.0.
  // Fail closed on a future version until reviewed against genuine samples.
  verify(/^API VERSION:\s*1\.0\r?\nAPI SOURCE:\s*NASA\/JPL Horizons API\r?\n(?:\r?\n)/.test(raw),
    'UNSUPPORTED_API_FORMAT');
  const fields = parseUniqueHorizonsHeaders(raw);
  const name = fields.targetName;
  const center = fields.centerName;
  const site = fields.centerSite;
  const unit = fields.outputUnits;
  const outputType = fields.outputType;
  const outputFormat = fields.outputFormat;
  const referenceFrame = fields.referenceFrame;
  const coordinateSystem = fields.coordinateSystem;
  const startTime = fields.startTime;
  verify(name && new RegExp('\\(' + expected.naifId + '\\)(?:\\s|$)').test(name),
    'TARGET_MISMATCH');
  verify(center && /^Solar System Barycenter\s*\(0\)(?:\s|$)/i.test(center) &&
    site === 'BODY CENTER', 'CENTER_MISMATCH');
  verify(unit === 'KM-S' && outputType === 'GEOMETRIC cartesian states' &&
    /^2\s*\(position and velocity\)$/i.test(outputFormat ?? '') &&
    /^ICRF(?:\/J2000\.0)?$/i.test(referenceFrame ?? '') &&
    /^Earth Mean Equator and Equinox of Reference Epoch$/i.test(coordinateSystem ?? '') &&
    startTime && /\bTDB\s*$/.test(startTime), 'MODEL_MISMATCH');
  const first = raw.indexOf('$$SOE');
  const last = raw.indexOf('$$EOE');
  verify(first >= 0 && last > first && raw.indexOf('$$SOE', first + 5) < 0 &&
    raw.indexOf('$$EOE', last + 5) < 0 &&
    /\bJDTDB\b/.test(raw.slice(0, first)), 'INVALID_VECTOR_TABLE');
  const lines = raw.slice(first + 5, last).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  verify(lines.length === 1, 'INVALID_VECTOR_TABLE');
  const fields = lines[0].split(',').map(x => x.trim());
  if (fields.at(-1) === '') fields.pop();
  verify(fields.length === 8 && /^A\.D\.\s+\d{4}-[A-Za-z]{3}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(fields[1]),
    'INVALID_VECTOR_TABLE');
  const numeric = [fields[0], ...fields.slice(2)];
  verify(numeric.every(v => NUMBER.test(v) && Number.isFinite(Number(v))), 'INVALID_VECTOR_TABLE');
  const values = numeric.map(Number);
  const requested = Number(expected.tdbJulianDay);
  verify(Number.isFinite(requested) && Math.abs(values[0] - requested) <= 5e-8,
    'EPOCH_MISMATCH');
  verify(values.slice(1, 4).every(v => Math.abs(v) < 1e14) &&
    values.slice(4).every(v => Math.abs(v) < 1e6), 'INVALID_VECTOR_TABLE');
  const sourceClaim = center.match(/\{source:\s*([A-Za-z0-9._+\-]{1,64})\}/i)?.[1] ?? null;
  return Object.freeze({
    status:'PARSED_VECTOR_UNAUTHENTICATED',
    bodyId:expected.bodyId,
    sourceClaim,
    positionKm:Object.freeze(values.slice(1, 4)),
    velocityKmPerSecond:Object.freeze(values.slice(4)),
    scientificallyValidated:false,
  });
}

/** Read an HTTP response body with a strict byte cap, including chunked bodies. */
async function readResponseBytes(response) {
  verify(response?.ok === true && response.status === 200 && response.body &&
    typeof response.body.getReader === 'function', 'FETCH_FAILED');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { completed = true; break; }
      verify(value instanceof Uint8Array, 'FETCH_FAILED');
      length += value.byteLength;
      verify(length > 0 && length <= MAX_RESPONSE_BYTES, 'RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  } finally {
    if (!completed) { try { await reader.cancel(); } catch {} }
    reader.releaseLock();
  }
  verify(length > 0, 'INVALID_RESPONSE');
  return Buffer.concat(chunks, length);
}

/**
 * Performs ten network calls ONLY when explicitly invoked, never on app startup.
 * A new exclusive directory is created and deleted on failure (never reused).
 */
export async function acquireHorizonsVectors(planPath, outputDirectory, options = {}) {
  const fetchFn = options.fetchFn ?? fetch;
  const pauseFn = options.pauseFn ?? wait;
  const pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS;
  verify(typeof fetchFn === 'function' && typeof pauseFn === 'function' &&
    Number.isInteger(pauseMs) && pauseMs >= 0 && pauseMs <= MAX_WAIT_MS,
    'INVALID_ARGUMENTS');
  const bytes = await readLocalPlan(planPath);
  let plan;
  try {
    plan = validateCanonicalPlan(JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(bytes)));
  } catch { fail('INVALID_PLAN'); }
  verify(plan, 'INVALID_PLAN');
  verify(typeof outputDirectory === 'string' && outputDirectory.length > 0 &&
    outputDirectory.length <= 4096 && outputDirectory.trim() === outputDirectory &&
    !/[\x00-\x1f\x7f]/.test(outputDirectory), 'INVALID_ARGUMENTS');
  // No pre-existing directory may be reused or cleaned up by this tool.
  await mkdir(outputDirectory, { mode:0o700 });
  let completed = false;
  let directoryIdentity = null;
  const createdFiles = [];
  try {
    directoryIdentity = await recordNewDirectory(outputDirectory);
    const manifest = {schemaVersion:1,status:'STRUCTURE_CHECKED_NOT_AUTHENTICATED',
      tdbJulianDay:plan.tdbJulianDay,frame:plan.frame,origin:plan.origin,
      responseCount:10,responses:[]};
    for (let i=0; i<plan.requests.length; i++) {
      const request = plan.requests[i];
      const url = new URL(request.url);
      verify(url.protocol === 'https:' && url.host === 'ssd.jpl.nasa.gov' &&
        url.pathname === '/api/horizons.api' && !url.username && !url.password,
        'INVALID_PLAN');
      if (i > 0) await pauseFn(pauseMs);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let responseBytes;
      try {
        const response = await fetchFn(request.url, {
          method:'GET',redirect:'error',cache:'no-store',credentials:'omit',
          signal:controller.signal,headers:{Accept:'text/plain'},
        });
        responseBytes = await readResponseBytes(response);
      } finally { clearTimeout(timeout); }
      let text;
      try { text = new TextDecoder('utf-8', {fatal:true}).decode(responseBytes); }
      catch { fail('INVALID_RESPONSE'); }
      const parsed = parseHorizonsVectorResponse(text, {...request,tdbJulianDay:plan.tdbJulianDay});
      verify(parsed.status === 'PARSED_VECTOR_UNAUTHENTICATED', 'INVALID_RESPONSE');
      // Never save transformed data in place of the original response bytes.
      await writeFile(join(outputDirectory, request.responseFilename), responseBytes, {flag:'wx',mode:0o600});
      createdFiles.push(await recordCreatedFile(outputDirectory,request.responseFilename));
      manifest.responses.push({bodyId:request.bodyId,naifId:request.naifId,
        responseFilename:request.responseFilename,
        queryUrlSha256:sha256(Buffer.from(request.url,'utf8')),
        originalResponseSha256:sha256(responseBytes),sourceClaim:parsed.sourceClaim});
    }
    await writeFile(join(outputDirectory,'response-manifest.json'),
      JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
    createdFiles.push(await recordCreatedFile(outputDirectory,'response-manifest.json'));
    completed = true;
    return Object.freeze({status:'CAPTURED_10_UNAUTHENTICATED_RESPONSES',count:10,
      scientificallyValidated:false});
  } finally {
    // Do not delete files added/edited by another process: leave any ambiguous
    // partial directory for explicit operator inspection instead of recursive rm.
    if (!completed) await cleanupOnlyOwnedFiles(outputDirectory,directoryIdentity,createdFiles);
  }
}

export function parseAcquisitionArgs(args) {
  if (!Array.isArray(args) || args.length !== 4) return null;
  const a = Object.create(null);
  for (let i=0; i<4; i+=2) {
    if (!['--plan','--output-dir'].includes(args[i]) || Object.hasOwn(a,args[i]) ||
      typeof args[i+1] !== 'string' || !args[i+1] ||
      args[i+1].startsWith('--') || /[\x00-\x1f\x7f]/.test(args[i+1])) return null;
    a[args[i]]=args[i+1];
  }
  return {planPath:a['--plan'],outputDirectory:a['--output-dir']};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseAcquisitionArgs(process.argv.slice(2));
  if (!opts) {
    process.stderr.write('HORIZONS_ACQUIRE:INVALID_ARGUMENTS\n');
    process.exitCode = 1;
  } else {
    try {
      const result = await acquireHorizonsVectors(opts.planPath,opts.outputDirectory);
      process.stdout.write('HORIZONS_ACQUIRE:'+result.status+'\n');
      process.stdout.write('Raw files require independent source and dataset verification.\n');
    } catch {
      process.stderr.write('HORIZONS_ACQUIRE:FAILED_SAFELY\n');
      process.exitCode = 1;
    }
  }
}
