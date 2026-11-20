/** Prepare the owner-authorized event archive and a resource-only Tauri overlay. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const REPOSITORY=resolve(ROOT,'../VirgoStars-Event-Ephemeris');
const REVISION='8c9591d56932441895ae47d0da0d2be41f0ec1c9';
export const EVENT_ARCHIVE_SHA256='c7746927f9132aea8fc338524d4bc6927010229e1589ff6f1bff5e4f8f6d8c2e';
export const EVENT_ARCHIVE_NAME='virgostars-events-20261110.vseph-p0';
export const EVENT_OVERRIDE=Object.freeze({bundle:{active:true,resources:{
  [`../.local/event-ephemeris/${EVENT_ARCHIVE_NAME}`]:`ephemeris/events/${EVENT_ARCHIVE_NAME}`,
}}});
const SUBDIRECTORY='datasets/2026-11-10/virgostars-events-20261110.vseph-p0.parts';
const PART_NAMES=['part-000','part-001','part-002'];
const MAX_PART_BYTES=2_000_000, MAX_ARCHIVE_BYTES=6_000_000;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

function requireRegular(path) {
  const stat=lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Event archive or configuration is not a regular file.');
  return stat;
}
async function loadParts() {
  if (existsSync(join(REPOSITORY,'.git'))) {
    try {
      return PART_NAMES.map(name=>execFileSync('git',['show',`${REVISION}:${SUBDIRECTORY}/${name}`],
        {cwd:REPOSITORY,maxBuffer:MAX_PART_BYTES,stdio:['ignore','pipe','ignore']}));
    } catch { /* A source checkout is optional when the pinned snapshot can be fetched. */ }
  }
  const parts=[];
  for (const name of PART_NAMES) {
    const url=`https://raw.githubusercontent.com/Cesare-ml/VirgoStars-Event-Ephemeris/${REVISION}/${SUBDIRECTORY}/${name}`;
    const response=await fetch(url,{signal:AbortSignal.timeout(60_000)});
    if (!response.ok) throw new Error(`Could not retrieve the pinned event archive (HTTP ${response.status}).`);
    const declared=Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared>MAX_PART_BYTES) throw new Error('Event archive part exceeds its size limit.');
    const reader=response.body?.getReader();
    if (!reader) throw new Error('Event archive download has no body.');
    const chunks=[];let size=0;
    for (;;) {
      const {done,value}=await reader.read();if (done) break;
      size+=value.byteLength;
      if (size>MAX_PART_BYTES) {await reader.cancel();throw new Error('Event archive part exceeds its size limit.');}
      chunks.push(Buffer.from(value));
    }
    parts.push(Buffer.concat(chunks));
  }
  return parts;
}

export async function prepareEventArchive(root=ROOT, load=loadParts) {
  const folder=join(root,'.local','event-ephemeris'), archive=join(folder,EVENT_ARCHIVE_NAME);
  mkdirSync(folder,{recursive:true});
  if (lstatSync(folder).isSymbolicLink()) throw new Error('Event archive directory must not be a symbolic link.');
  if (existsSync(archive)) {
    if (requireRegular(archive).size>MAX_ARCHIVE_BYTES || digest(readFileSync(archive))!==EVENT_ARCHIVE_SHA256)
      throw new Error('Existing event archive does not match the pinned snapshot; left untouched.');
  } else {
    const parts=await load();
    if (!Array.isArray(parts) || parts.length!==3 || parts.some(part=>!Buffer.isBuffer(part) || part.length>MAX_PART_BYTES))
      throw new Error('Invalid event archive parts.');
    const bytes=Buffer.concat(parts);
    if (bytes.length>MAX_ARCHIVE_BYTES || digest(bytes)!==EVENT_ARCHIVE_SHA256) throw new Error('Event archive does not match the pinned snapshot.');
    writeFileSync(archive,bytes,{flag:'wx'});
  }
  const overlay=join(folder,'tauri-events.conf.json'), canonical=JSON.stringify(EVENT_OVERRIDE,null,2)+'\n';
  if (existsSync(overlay)) requireRegular(overlay);
  writeFileSync(overlay,canonical);
  if (readFileSync(overlay,'utf8')!==canonical) throw new Error('Event archive Tauri configuration could not be verified.');
  return Object.freeze({sha256:EVENT_ARCHIVE_SHA256,bytes:requireRegular(archive).size});
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  prepareEventArchive().then(result=>console.log(`Verified event archive for offline packaging (${result.bytes} bytes).`))
    .catch(error=>{console.error(`EVENT_ARCHIVE_PREPARATION_FAILED: ${error.message}`);process.exitCode=1;});
}
