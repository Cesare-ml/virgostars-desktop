import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rename,rm,symlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {fingerprintActualSkyFile,guardActualSnapshotDuringReview} from '../scripts/ephemeris/de441-actual-snapshot-integrity.mjs';

const sha=s=>createHash('sha256').update(s).digest('hex');
const passed=()=>({status:'REVIEW_WITHIN_TOLERANCE_EXPERIMENTAL',
  maxDirectionArcsec:0.5,maxDistancePpm:2,maxEpochSeconds:0.02,
  scientificallyValidated:false,secret:'private birth details'});
const outside=()=>({...passed(),status:'REVIEW_OUTSIDE_TOLERANCE_EXPERIMENTAL'});
const parsed=path=>({comparison:{actual:path}});
async function withFile(fn) {
  const dir=await mkdtemp(join(tmpdir(),'vs-actual-'));
  const path=join(dir,'sky.json');
  const data=JSON.stringify({synthetic:true, positions:[1,2,3]});
  try {await writeFile(path,data);return await fn({dir,path,data});}
  finally {await rm(dir,{recursive:true,force:true});}
}

test('fingerprint streams bytes of a regular file, returning SHA256 only',async()=>withFile(async({path,data})=>{
  assert.equal(await fingerprintActualSkyFile(path),sha(data));
}));
test('changed contents lead to a different fingerprint',async()=>withFile(async({path,data})=>{
  const a=await fingerprintActualSkyFile(path);
  await writeFile(path,data+' ');
  assert.notEqual(await fingerprintActualSkyFile(path),a);
}));
test('missing, empty, too-large and control-character paths fail closed',async()=>withFile(async({dir,path})=>{
  assert.equal(await fingerprintActualSkyFile(join(dir,'missing')),null);
  assert.equal(await fingerprintActualSkyFile(path+'\n'),null);
  await writeFile(path,'');assert.equal(await fingerprintActualSkyFile(path),null);
  await writeFile(path,'x'.repeat(128*1024+1));
  assert.equal(await fingerprintActualSkyFile(path),null);
}));
test('refuse directories and symbolic links',async t=>withFile(async({dir,path})=>{
  const directory=join(dir,'folder');await mkdir(directory);
  assert.equal(await fingerprintActualSkyFile(directory),null);
  const link=join(dir,'sky-link.json');
  try {await symlink(path,link);} catch(e) {
    if (['EPERM','EACCES'].includes(e?.code)){t.skip('system forbids symlinks');return;}
    throw e;
  }
  assert.equal(await fingerprintActualSkyFile(link),null);
}));
test('a stable real file surrounds one review and exposes only safe metrics',async()=>withFile(async({path,dir})=>{
  let calls=0;
  const out=await guardActualSnapshotDuringReview(parsed(path),async()=>{calls++;return passed();});
  assert.equal(calls,1);
  assert.deepEqual(out,{status:'REVIEW_WITHIN_TOLERANCE_EXPERIMENTAL',
    maxDirectionArcsec:0.5,maxDistancePpm:2,maxEpochSeconds:0.02,scientificallyValidated:false});
  assert.equal(JSON.stringify(out).includes(dir),false);
  assert.equal(JSON.stringify(out).includes('private'),false);
}));
test('mutation during numeric comparison blocks, even if comparison itself passes',async()=>withFile(async({path})=>{
  const out=await guardActualSnapshotDuringReview(parsed(path),async()=>{
    await writeFile(path,'{"changed":"fake sky"}');return passed();
  });
  assert.deepEqual(out,{status:'REVIEW_BLOCKED',reason:'ACTUAL_CHANGED',scientificallyValidated:false});
}));
test('replacement with a different file is blocked',async()=>withFile(async({dir,path})=>{
  const alternate=join(dir,'new-sky.json');await writeFile(alternate,'{"different":true}');
  const out=await guardActualSnapshotDuringReview(parsed(path),async()=>{
    await rename(alternate,path);return passed();
  });
  assert.equal(out.reason,'ACTUAL_CHANGED');
}));
test('disappearing file blocks without printing paths',async()=>withFile(async({path,dir})=>{
  const out=await guardActualSnapshotDuringReview(parsed(path),async()=>{
    await rm(path);return passed();
  });
  assert.equal(out.reason,'ACTUAL_UNAVAILABLE');
  assert.equal(JSON.stringify(out).includes(dir),false);
}));
test('no review is launched when initial snapshot is missing',async()=>{
  let calls=0;
  const out=await guardActualSnapshotDuringReview(parsed('/nonexistent/file.json'),async()=>{calls++;return passed();});
  assert.equal(calls,0);assert.equal(out.reason,'ACTUAL_UNAVAILABLE');
});
test('outside-tolerance review remains an outside-tolerance result',async()=>withFile(async({path})=>{
  const out=await guardActualSnapshotDuringReview(parsed(path),async()=>outside());
  assert.equal(out.status,'REVIEW_OUTSIDE_TOLERANCE_EXPERIMENTAL');
  assert.equal(out.scientificallyValidated,false);
}));
test('existing blocked reasons remain sanitized and untrusted text is never reflected',async()=>withFile(async({path})=>{
  const a=await guardActualSnapshotDuringReview(parsed(path),async()=>({status:'REVIEW_BLOCKED',reason:'EVIDENCE_CHANGED'}));
  const b=await guardActualSnapshotDuringReview(parsed(path),async()=>({status:'REVIEW_BLOCKED',reason:'private/path'}));
  assert.equal(a.reason,'EVIDENCE_CHANGED');assert.equal(b.reason,'REVIEW_INVALID');
}));
test('forged validated or incomplete numerical results fail closed',async()=>withFile(async({path})=>{
  for(const result of [undefined,null,{}, {...passed(),scientificallyValidated:true},
    {...passed(),maxEpochSeconds:NaN}, {...passed(),maxDistancePpm:-1},
    {...passed(),status:'READY'}, {...passed(),status:'EXACT_VALIDATED'}]){
    const out=await guardActualSnapshotDuringReview(parsed(path),async()=>result);
    assert.equal(out.reason,'REVIEW_INVALID');
  }
}));
test('invalid injected operations or exception return fixed blocked outcomes',async()=>withFile(async({path})=>{
  const a=await guardActualSnapshotDuringReview(parsed(path),null);
  const b=await guardActualSnapshotDuringReview(parsed(path),async()=>passed(),{fingerprint:4});
  const c=await guardActualSnapshotDuringReview(parsed(path),async()=>{throw Error('secret record');});
  assert.equal(a.reason,'INVALID_ARGUMENTS');assert.equal(b.reason,'INVALID_OPERATIONS');
  assert.equal(c.reason,'REVIEW_UNAVAILABLE');
}));
test('a mocked identical digest is allowed only as an unverified test, never certification',async()=>{
  let count=0;const out=await guardActualSnapshotDuringReview(parsed('fictional.json'),async()=>{
    count++;return passed();
  },{fingerprint:async()=>sha('synthetic test')});
  assert.equal(count,1);assert.equal(out.scientificallyValidated,false);
});
test('changed injected digest or invalid digest fails without trusting the comparator',async()=>{
  let count=0;
  const changed=await guardActualSnapshotDuringReview(parsed('fictional.json'),async()=>passed(),{
    fingerprint:async()=>++count===1?sha('first'):sha('second')});
  const invalid=await guardActualSnapshotDuringReview(parsed('fictional.json'),async()=>passed(),{
    fingerprint:async()=>'/private/path'});
  assert.equal(changed.reason,'ACTUAL_CHANGED');
  assert.equal(invalid.reason,'ACTUAL_UNAVAILABLE');
});
