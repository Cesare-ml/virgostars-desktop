/**
 * Opt-in, no-private-data JPL Horizons transport-version probe.
 * This intentionally queries an error/metadata-only API URL (no COMMAND,
 * date, place or ephemeris), and NEVER certifies vector/schema compatibility.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HORIZONS_WIRE_PROBE_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api?format=text';
const MAX_BYTES = 8192;
const TIMEOUT_MS = 10000;
const safe = status => Object.freeze({status, scientificallyValidated:false, vectorFormatApproved:false});

/** Parse only the fixed transport preamble, not error text or ephemerides. */
export function inspectHorizonsWireEnvelope(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > MAX_BYTES) return safe('UNRECOGNIZED_ENVELOPE');
  const match = /^API VERSION: ([0-9]{1,3}\.[0-9]{1,3})\r?\nAPI SOURCE: NASA\/JPL Horizons API\r?\n(?:\r?\n)/.exec(raw);
  if (!match) return safe('UNRECOGNIZED_ENVELOPE');
  if (match[1] === '1.2') return safe('WIRE_1_2_REQUIRES_VECTOR_REVIEW');
  if (match[1] === '1.0') return safe('WIRE_1_0_REQUIRES_VECTOR_REVIEW');
  return safe('UNKNOWN_WIRE_VERSION_REQUIRES_REVIEW');
}

async function boundedResponse(response) {
  if (response?.status !== 200 || !response.ok || !response.body ||
      typeof response.body.getReader !== 'function') throw Error('UNAVAILABLE');
  const ct=response.headers?.get?.('content-type');
  if (ct && ct.split(';',1)[0].toLowerCase().trim() !== 'text/plain') throw Error('BAD_CONTENT_TYPE');
  if (response.url && response.url !== HORIZONS_WIRE_PROBE_URL) throw Error('UNEXPECTED_RESPONSE_URL');
  const reader=response.body.getReader();
  const pieces=[];let length=0,finished=false;
  try {
    while (true) {
      const chunk=await reader.read();
      if (chunk.done) { finished=true;break; }
      if (!(chunk.value instanceof Uint8Array)) throw Error('INVALID_STREAM');
      length+=chunk.value.byteLength;
      if (length>MAX_BYTES) throw Error('RESPONSE_TOO_LARGE');
      pieces.push(Buffer.from(chunk.value));
    }
  } finally {
    if (!finished) { try { await reader.cancel(); } catch {} }
    reader.releaseLock();
  }
  if (!length) throw Error('EMPTY_RESPONSE');
  return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(pieces,length));
}

/** Fixed public metadata-only URL; no user-provided endpoint or query allowed. */
export async function probeHorizonsWireVersion({fetchFn=fetch}={}) {
  if (typeof fetchFn !== 'function') return safe('PROBE_UNAVAILABLE');
  const abort=new AbortController();
  const timeout=setTimeout(()=>abort.abort(),TIMEOUT_MS);
  try {
    const response=await fetchFn(HORIZONS_WIRE_PROBE_URL, {
      method:'GET', redirect:'error', credentials:'omit',cache:'no-store',
      headers:{Accept:'text/plain'},signal:abort.signal,
    });
    return inspectHorizonsWireEnvelope(await boundedResponse(response));
  } catch {
    return safe('PROBE_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if (process.argv.length!==3 || process.argv[2]!=='--probe') {
    process.stdout.write('HORIZONS_WIRE:INVALID_ARGUMENTS\n');
    process.exitCode=2;
  } else {
    const result=await probeHorizonsWireVersion();
    process.stdout.write('HORIZONS_WIRE:'+result.status+'\n');
    process.stdout.write('TRANSPORT VERSION ONLY: NO ASTRONOMICAL VECTORS ACCEPTED OR VALIDATED\n');
    process.exitCode=result.status==='PROBE_UNAVAILABLE'?1:0;
  }
}
