/** Manual-only verified DE441 multi-site campaign. No astronomical calculation. */
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validVerifiedCampaign,runVerifiedCampaign} from './verified-de441-campaign.mjs';
import {runVerifiedDe441Audit} from './run-verified-de441-audit.mjs';

const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) |
  (constants.O_NONBLOCK ?? 0);
const BLOCK_BYTES = 16*1024;
function sameFile(a,b) {
  return a.dev===b.dev && a.ino===b.ino && a.size===b.size &&
    a.mtimeNs===b.mtimeNs && a.ctimeNs===b.ctimeNs;
}

/** Bounded and read-only; refuse links, pipes, directories and file changes. */
async function readSmallJson(path,maxBytes) {
  let file;
  try {
    const atPath=await lstat(path,{bigint:true});
    if(!atPath.isFile() || atPath.size<2n || atPath.size>BigInt(maxBytes)) throw Error();
    file=await open(path,READ_FLAGS);
    const before=await file.stat({bigint:true});
    if(!before.isFile() || !sameFile(atPath,before)) throw Error();
    const size=Number(before.size),bytes=Buffer.alloc(size);
    let offset=0;
    while(offset<size) {
      const {bytesRead}=await file.read(bytes,offset,Math.min(BLOCK_BYTES,size-offset),offset);
      if(!bytesRead) throw Error();
      offset+=bytesRead;
    }
    const extra=Buffer.alloc(1);
    if((await file.read(extra,0,1,size)).bytesRead!==0) throw Error();
    const after=await file.stat({bigint:true});
    const atPathAfter=await lstat(path,{bigint:true});
    if(!atPathAfter.isFile() || !sameFile(before,after) ||
        !sameFile(atPath,atPathAfter)) throw Error();
    return {data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),
      sha256:createHash('sha256').update(bytes).digest('hex')};
  } catch {throw Error('INVALID_LOCAL_FILE');}
  finally {if(file)try{await file.close();}catch{}}
}

export async function runLocalCampaign(manifestFile) {
  const {data:manifest}=await readSmallJson(manifestFile,64*1024);
  if(!validVerifiedCampaign(manifest)) return {status:'INVALID_CAMPAIGN'};
  const directory=dirname(manifestFile);
  const local=name=>join(directory,name); // basenames already allowlisted
  return runVerifiedCampaign(manifest,{
    readActual:async name=>{
      const {data,sha256}=await readSmallJson(local(name),128*1024);
      return {utcIso:data?.utcIso,latMicro:data?.latMicro,
        lngMicro:data?.lngMicro,heightMeters:data?.heightMeters,sha256};
    },
    auditCase:(c,tolerance)=>runVerifiedDe441Audit({
      evidence:{reference:local(c.referenceFile),rawSource:local(c.rawSourceFile),
        rawQuery:local(c.rawQueryFile),normalizerSource:local(c.normalizerFile)},
      comparison:{actual:local(c.actualFile),reference:local(c.referenceFile),
        rawSource:local(c.rawSourceFile),tolerance},
    }),
  });
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if(args.length!==1 || !args[0] || args[0].startsWith('-')) {
    process.stderr.write('VERIFIED_DE441_CAMPAIGN:ARGUMENTS_REQUIRED\n');
    process.exitCode=2;
  } else {
    try {
      const result=await runLocalCampaign(resolve(args[0]));
      if(result.status==='PROVISIONAL_ALL_WITHIN') {
        process.stdout.write('VERIFIED_DE441_CAMPAIGN:PROVISIONAL_ALL_WITHIN checked='+result.checked+'\n');
        process.stdout.write('NOT independently certified science, not chart-ready.\n');
      } else if(result.status==='CAMPAIGN_FAILED') {
        process.stderr.write('VERIFIED_DE441_CAMPAIGN:FAILED checked='+result.checked+
          ' blocked='+result.blocked+' outside='+result.outside+'\n');
        process.exitCode=1;
      } else {
        process.stderr.write('VERIFIED_DE441_CAMPAIGN:INVALID_CAMPAIGN\n');
        process.exitCode=2;
      }
    } catch {
      process.stderr.write('VERIFIED_DE441_CAMPAIGN:INVALID_LOCAL_FILE\n');
      process.exitCode=2;
    }
  }
}
