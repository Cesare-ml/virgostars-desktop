import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm,symlink,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyReferenceEvidence,fingerprintExperimentalSnapshot} from '../scripts/ephemeris/verify-reference-evidence.mjs';

const digest=b=>createHash('sha256').update(b).digest('hex');
const cli=fileURLToPath(new URL('../scripts/ephemeris/verify-reference-evidence.mjs',import.meta.url));
async function bundle(callback) {
  const dir=await mkdtemp(join(tmpdir(),'vs-evidence-'));
  const paths={reference:join(dir,'reference.json'),rawSource:join(dir,'horizons.txt'),
    rawQuery:join(dir,'query.txt'),normalizerSource:join(dir,'normalizer.py')};
  const rawSource=Buffer.from('SYNTHETIC HORIZONS SHAPED SOURCE: not JPL data\n');
  const rawQuery=Buffer.from('synthetic query parameters\n');
  const normalizerSource=Buffer.from('print("fictional transformation only")\n');
  const reference={schemaVersion:1,provenance:{source:'JPL_HORIZONS',
    rawResponseSha256:digest(rawSource),querySha256:digest(rawQuery),
    normalizationCodeSha256:digest(normalizerSource),
    normalizationNotes:'Synthetic mock, not a real astronomical normalizer'},
    positions:[]};
  try {
    await Promise.all([writeFile(paths.rawSource,rawSource),writeFile(paths.rawQuery,rawQuery),
      writeFile(paths.normalizerSource,normalizerSource),
      writeFile(paths.reference,JSON.stringify(reference))]);
    await callback({dir,paths,reference});
  } finally {await rm(dir,{recursive:true,force:true});}
}

test('four synthetic evidence files pass byte-identity checks, never scientific validation',async()=>bundle(async({paths})=>{
  const r=await verifyReferenceEvidence(paths);
  assert.equal(r.status,'EVIDENCE_BYTES_MATCH');
  assert.equal(r.scientificallyValidated,false);
  assert.equal(r.sourceAuthenticated,false);
  assert.equal(r.normalizationReviewed,false);
  assert.equal(r.referenceSha256,digest(await readFile(paths.reference)));
}));
test('real experimental JSON SHA is reproducible, and changed bytes produce different digest',async()=>bundle(async({paths})=>{
  const before=await fingerprintExperimentalSnapshot(paths.reference);
  assert.equal(before.status,'SNAPSHOT_FINGERPRINTED');
  await writeFile(paths.reference,(await readFile(paths.reference)).toString()+' ');
  const after=await fingerprintExperimentalSnapshot(paths.reference);
  assert.equal(after.status,'SNAPSHOT_FINGERPRINTED');
  assert.notEqual(before.sha256,after.sha256);
}));
test('modified saved query is rejected without revealing its contents',async()=>bundle(async({paths})=>{
  await writeFile(paths.rawQuery,'private data changed');
  const r=await verifyReferenceEvidence(paths);
  assert.deepEqual(r,{status:'EVIDENCE_REJECTED',reason:'EVIDENCE_DIGEST_MISMATCH'});
  assert.doesNotMatch(JSON.stringify(r),/private data/);
}));
test('malformed UTF-8 JSON reference fails strict decoding with fixed status',async()=>bundle(async({paths})=>{
  const data=await readFile(paths.reference);
  await writeFile(paths.reference,Buffer.concat([data,Buffer.from([0xc3,0x28])]));
  const r=await verifyReferenceEvidence(paths);
  assert.deepEqual(r,{status:'EVIDENCE_REJECTED',reason:'INVALID_REFERENCE'});
}));
test('oversize reference file cannot be fingerprinted',async()=>bundle(async({paths})=>{
  await writeFile(paths.reference,Buffer.alloc(128*1024+1,65));
  assert.deepEqual(await fingerprintExperimentalSnapshot(paths.reference),{status:'SNAPSHOT_REJECTED'});
}));
test('rejects symlinks to evidence before opening them',async t=>bundle(async({dir,paths})=>{
  const source=join(dir,'source-target.txt');await writeFile(source,'secret');
  try {await rm(paths.rawSource);await symlink(source,paths.rawSource);} catch(e) {
    if (['EPERM','EACCES'].includes(e?.code)){t.skip('Symlink permission unavailable');return;}
    throw e;
  }
  const r=await verifyReferenceEvidence(paths);
  assert.deepEqual(r,{status:'EVIDENCE_REJECTED',reason:'UNSAFE_FILE'});
}));
test('rejects a directory used as an evidence file',async()=>bundle(async({paths})=>{
  await rm(paths.rawSource);await mkdir(paths.rawSource);
  assert.equal((await verifyReferenceEvidence(paths)).reason,'UNSAFE_FILE');
}));
test('the same physical file cannot stand in for different provenance evidence',async()=>bundle(async({paths})=>{
  const r=await verifyReferenceEvidence({...paths,rawQuery:paths.rawSource});
  assert.deepEqual(r,{status:'EVIDENCE_REJECTED',reason:'REUSED_FILE'});
}));
test('the direct CLI is sanitized and never prints input paths or astronomy',async()=>bundle(async({dir,paths})=>{
  const args=['--reference',paths.reference,'--raw-source',paths.rawSource,
    '--raw-query',paths.rawQuery,'--normalizer-source',paths.normalizerSource];
  const out=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:5000});
  assert.equal(out.status,0,out.stderr);
  assert.match(out.stdout,/REFERENCE_EVIDENCE:EVIDENCE_BYTES_MATCH/);
  assert.equal((out.stdout+out.stderr).includes(dir),false);
  await writeFile(paths.rawSource,'bad source bytes');
  const fail=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:5000});
  assert.equal(fail.status,1);
  assert.match(fail.stderr,/REFERENCE_EVIDENCE:EVIDENCE_DIGEST_MISMATCH/);
  assert.equal((fail.stdout+fail.stderr).includes(dir),false);
}));
test('a named pipe is rejected without blocking read operations',{skip:process.platform==='win32'},async t=>bundle(async({paths})=>{
  await rm(paths.rawSource);
  const p=spawnSync('mkfifo',[paths.rawSource],{encoding:'utf8',timeout:3000});
  if(p.error?.code==='ENOENT'){t.skip('mkfifo unavailable');return;}
  assert.equal(p.status,0);
  const r=await Promise.race([verifyReferenceEvidence(paths),new Promise((_,reject)=>setTimeout(()=>reject(Error('timeout')),3000))]);
  assert.equal(r.reason,'UNSAFE_FILE');
}));
test('source code explicitly checks for append, post-path swap and nonblocking open',async()=>{
  const source=await readFile(fileURLToPath(new URL('../scripts/ephemeris/verify-reference-evidence.mjs',import.meta.url)),'utf8');
  assert.match(source,/constants\.O_NONBLOCK/);
  assert.match(source,/const extra = await handle\.read\(buffer, 0, 1, total\)/);
  assert.match(source,/const pathAfter = await lstat\(path, \{bigint:true\}\)/);
  assert.match(source,/pathAfter\.ino !== current\.ino/);
  assert.match(source,/new TextDecoder\('utf-8', \{fatal:true\}\)/);
});
