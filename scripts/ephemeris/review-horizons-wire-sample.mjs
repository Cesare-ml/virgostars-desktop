/**
 * Offline structural review of one *unmodified* Horizons text sample with wire
 * version 1.2. This is NOT a vector normalizer or acquisition acceptance gate.
 * No URL access, output file write, coordinates in status, or chart readiness.
 */
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HORIZONS_BODIES, parseReviewedTdbJulianDay } from './prepare-horizons-vector-plan.mjs';
import { parseUniqueHorizonsHeaders } from './strict-horizons-headers.mjs';

const MAX_BYTES=512*1024;
const NUMBER=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/;
const safe=(status)=>Object.freeze({status,scientificallyValidated:false,
  sourceAuthenticated:false,vectorFormatApproved:false,comparisonReady:false});
const matchNode=(a,b)=>a.isFile() && b.isFile() && a.dev===b.dev && a.ino===b.ino &&
  a.size===b.size && a.mtimeNs===b.mtimeNs && a.ctimeNs===b.ctimeNs;

/**
 * Only a single regular, unchanged, bounded original file can be reviewed.
 * The file never leaves local storage and is not retained by this module.
 */
export async function readSampleOnce(path) {
  if(typeof path!=='string' || !path || path.trim()!==path || path.length>4096 ||
      /[\x00-\x1f\x7f]/.test(path))throw Error('INVALID_SAMPLE');
  let file;
  try {
    const first=await lstat(path,{bigint:true});
    if(!first.isFile() || first.isSymbolicLink() || first.size===0n ||
        first.size>BigInt(MAX_BYTES))throw Error('INVALID_SAMPLE');
    file=await open(path,constants.O_RDONLY | (constants.O_NOFOLLOW??0) |
      (constants.O_NONBLOCK??0));
    const opened=await file.stat({bigint:true});
    if(!matchNode(first,opened))throw Error('INVALID_SAMPLE');
    const bytes=Buffer.alloc(Number(first.size));
    let offset=0;
    while(offset<bytes.length){
      const {bytesRead}=await file.read(bytes,offset,bytes.length-offset,offset);
      if(bytesRead===0)throw Error('INVALID_SAMPLE');
      offset+=bytesRead;
    }
    const end=await file.stat({bigint:true});
    const pathEnd=await lstat(path,{bigint:true});
    if(!matchNode(first,end) || !matchNode(first,pathEnd))throw Error('INVALID_SAMPLE');
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  } catch {throw Error('INVALID_SAMPLE');}
  finally {if(file) await file.close();}
}

/** Classify one wire-1.2 vector *format*; the values never escape the parser. */
export function inspectWire12VectorSample(raw,bodyId,reviewedTdbJulianDay) {
  const body=HORIZONS_BODIES.find(b=>b.bodyId===bodyId);
  const jd=parseReviewedTdbJulianDay(reviewedTdbJulianDay);
  if(!body || !jd)return safe('INVALID_REVIEW_REQUEST');
  if(typeof raw!=='string' || Buffer.byteLength(raw,'utf8')>MAX_BYTES ||
      !/^API VERSION: 1\.2\r?\nAPI SOURCE: NASA\/JPL Horizons API\r?\n\r?\n/.test(raw))
    return safe('NOT_WIRE_1_2_TEXT');
  let h;
  try {h=parseUniqueHorizonsHeaders(raw);} catch {return safe('MALFORMED_OR_AMBIGUOUS_HEADERS');}
  if(h.apiVersion!=='1.2' || h.apiSource!=='NASA/JPL Horizons API')
    return safe('NOT_WIRE_1_2_TEXT');
  if(!new RegExp('\\('+body.naifId+'\\)(?:\\s|$)').test(h.targetName))
    return safe('WRONG_TARGET');
  if(!/^Solar System Barycenter\s*\(0\)(?:\s|$)/i.test(h.centerName) ||
      h.centerSite!=='BODY CENTER' || h.outputUnits!=='KM-S' ||
      h.outputType!=='GEOMETRIC cartesian states' ||
      !/^2\s*\(position and velocity\)$/i.test(h.outputFormat) ||
      !/^ICRF(?:\/J2000\.0)?$/i.test(h.referenceFrame) ||
      h.coordinateSystem!=='Earth Mean Equator and Equinox of Reference Epoch' ||
      !/\bTDB\s*$/.test(h.startTime))return safe('MODEL_MISMATCH');
  const soe=raw.indexOf('$$SOE'),eoe=raw.indexOf('$$EOE');
  if(soe<0 || eoe<soe+5 || raw.indexOf('$$SOE',soe+5)>=0 ||
      raw.indexOf('$$EOE',eoe+5)>=0 || !/\bJDTDB\b/.test(raw.slice(0,soe)))
    return safe('UNRECOGNIZED_VECTOR_TABLE');
  const lines=raw.slice(soe+5,eoe).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(lines.length!==1)return safe('UNRECOGNIZED_VECTOR_TABLE');
  const cells=lines[0].split(',').map(x=>x.trim());
  if(cells.at(-1)==='')cells.pop();
  if(cells.length!==8 || !/^A\.D\.\s+\d{4}-[A-Za-z]{3}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(cells[1]))
    return safe('UNRECOGNIZED_VECTOR_TABLE');
  const values=[cells[0],...cells.slice(2)];
  if(!values.every(x=>NUMBER.test(x) && Number.isFinite(Number(x))) ||
      values.slice(1,4).some(x=>Math.abs(Number(x))>=1e14) ||
      values.slice(4).some(x=>Math.abs(Number(x))>=1e6))
    return safe('UNRECOGNIZED_VECTOR_TABLE');
  if(Math.abs(Number(cells[0])-Number(jd))>5e-8)return safe('EPOCH_MISMATCH');
  // A syntactically recognizable 1.2 record is still not independently
  // normalized, kernel-verified, dataset-identified or chart-approved.
  return safe('WIRE_1_2_STRUCTURE_REVIEWABLE_UNVERIFIED');
}

export async function reviewWire12Sample(path,bodyId,jd) {
  try {return inspectWire12VectorSample(await readSampleOnce(path),bodyId,jd);}
  catch {return safe('UNSAFE_OR_UNREADABLE_SAMPLE');}
}

export function parseReviewArgs(args) {
  if(!Array.isArray(args) || args.length!==6)return null;
  const result=Object.create(null);
  for(let i=0;i<args.length;i+=2){
    const k=args[i],v=args[i+1];
    if(!['--file','--body','--tdb-jd'].includes(k) || Object.hasOwn(result,k) ||
        typeof v!=='string' || !v || v.startsWith('--') || /[\x00-\x1f\x7f]/.test(v))return null;
    result[k]=v;
  }
  if(!result['--file'] || !HORIZONS_BODIES.some(x=>x.bodyId===result['--body']) ||
      !parseReviewedTdbJulianDay(result['--tdb-jd']))return null;
  return {path:result['--file'],bodyId:result['--body'],jd:result['--tdb-jd']};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const opts=parseReviewArgs(process.argv.slice(2));
  const result=opts ? await reviewWire12Sample(opts.path,opts.bodyId,opts.jd) : safe('INVALID_REVIEW_REQUEST');
  process.stdout.write('HORIZONS_WIRE12_REVIEW:'+result.status+'\n');
  process.exitCode=result.status==='WIRE_1_2_STRUCTURE_REVIEWABLE_UNVERIFIED'?0:1;
}
