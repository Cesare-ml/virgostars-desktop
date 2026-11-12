/** Local-only bounded multi-case reference audit; no scientific certification. */
import {openSync, closeSync, fstatSync, lstatSync, readSync, constants} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {runReferenceCampaign} from './de441-reference-campaign.mjs';

const MAX_BYTES = 128 * 1024;
const FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
function sameFile(a,b) {
  return a.dev===b.dev && a.ino===b.ino && a.size===b.size &&
    a.mtimeNs===b.mtimeNs && a.ctimeNs===b.ctimeNs;
}
function readJsonFile(path) {
  let handle;
  try {
    const beforePath=lstatSync(path,{bigint:true});
    if(!beforePath.isFile() || beforePath.size<2n || beforePath.size>BigInt(MAX_BYTES)) throw Error();
    handle=openSync(path,FLAGS);
    const before=fstatSync(handle,{bigint:true});
    if(!before.isFile() || !sameFile(beforePath,before)) throw Error();
    const buffer=Buffer.alloc(Number(before.size)+1);
    let len=0;
    while(len<buffer.length) {
      const n=readSync(handle,buffer,len,buffer.length-len,null);
      if(!n) break;
      len+=n;
    }
    const after=fstatSync(handle,{bigint:true});
    const pathAfter=lstatSync(path,{bigint:true});
    if(len!==Number(before.size) || !pathAfter.isFile() ||
        !sameFile(before,after) || !sameFile(beforePath,pathAfter)) throw Error();
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,len)));
  } catch { throw Error('INVALID_LOCAL_FILE'); }
  finally { if(handle!==undefined)try{closeSync(handle);}catch{} }
}
const args=process.argv.slice(2);
if(args.length!==1 || !args[0] || args[0].startsWith('-')) {
  process.stderr.write('DE441_CAMPAIGN:ARGUMENTS_REQUIRED\n');process.exitCode=2;
} else {
  const manifestPath=resolve(args[0]);
  try {
    const manifest=readJsonFile(manifestPath);
    const dir=dirname(manifestPath);
    const result=await runReferenceCampaign(manifest, name => readJsonFile(join(dir,name)));
    if(result.kind==='invalid_campaign') {
      process.stderr.write('DE441_CAMPAIGN:INVALID_CAMPAIGN\n');process.exitCode=2;
    } else if(result.kind==='campaign_failed') {
      process.stderr.write('DE441_CAMPAIGN:FAILED checked='+result.checked+' failed='+result.failed+'\n');
      process.exitCode=1;
    } else {
      process.stdout.write('DE441_CAMPAIGN:PROVISIONAL_ALL_WITHIN checked='+result.checked+'\n');
      process.stdout.write('Scientific accuracy, independent provenance and chart readiness are NOT certified.\n');
    }
  } catch {
    process.stderr.write('DE441_CAMPAIGN:INVALID_LOCAL_FILE\n');process.exitCode=2;
  }
}
