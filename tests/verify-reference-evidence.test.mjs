import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, symlink, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyReferenceEvidence, parseEvidenceArgs } from '../scripts/ephemeris/verify-reference-evidence.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const data = Object.freeze({
  rawSource:'Fictional Horizons-style response; NOT authenticated JPL data.\n',
  rawQuery:'COMMAND=499&MAKE_EPHEM=YES&fictional_only=1\n',
  normalizerSource:'// Fictional normalizer, does not implement astronomy\n',
});
function reference() {
  return {schemaVersion:1,provenance:{
    source:'JPL_HORIZONS',rawResponseSha256:hash(data.rawSource),
    querySha256:hash(data.rawQuery),normalizationCodeSha256:hash(data.normalizerSource),
    normalizationNotes:'Fictional input; deliberately not an independent Horizons reduction.',
  }};
}
async function fixture(run) {
  const dir=await mkdtemp(join(tmpdir(),'vs-reference-evidence-'));
  const paths={
    reference:join(dir,'normalized.json'),rawSource:join(dir,'horizons-raw.txt'),
    rawQuery:join(dir,'query.txt'),normalizerSource:join(dir,'normalize.py'),
  };
  try {
    await Promise.all(Object.entries(paths).map(([name,path]) =>
      writeFile(path,name==='reference' ? JSON.stringify(reference()) : data[name])));
    await run(paths,dir);
  } finally { await rm(dir,{recursive:true,force:true}); }
}
const accepted = {status:'EVIDENCE_BYTES_MATCH',scientificallyValidated:false,
  sourceAuthenticated:false,normalizationReviewed:false};

test('checks all four separate synthetic evidence files and never claims science',async()=>fixture(async paths=>{
  assert.deepEqual(await verifyReferenceEvidence(paths),{...accepted,
    referenceSha256:hash(JSON.stringify(reference()))});
}));
test('rejects edits to saved original Horizons response',async()=>fixture(async paths=>{
  await writeFile(paths.rawSource,data.rawSource+'changed');
  assert.equal((await verifyReferenceEvidence(paths)).reason,'EVIDENCE_DIGEST_MISMATCH');
}));
test('rejects edits to saved original Horizons query',async()=>fixture(async paths=>{
  await writeFile(paths.rawQuery,data.rawQuery+'changed');
  assert.equal((await verifyReferenceEvidence(paths)).reason,'EVIDENCE_DIGEST_MISMATCH');
}));
test('rejects edits to saved independent normalization source',async()=>fixture(async paths=>{
  await writeFile(paths.normalizerSource,data.normalizerSource+'changed');
  assert.equal((await verifyReferenceEvidence(paths)).reason,'EVIDENCE_DIGEST_MISMATCH');
}));
test('rejects missing query, normalizer, response and reference files',async()=>fixture(async paths=>{
  for(const key of Object.keys(paths)) {
    const file=paths[key];
    await rm(file);
    assert.equal((await verifyReferenceEvidence(paths)).reason,'UNSAFE_FILE');
    await writeFile(file,key==='reference'?JSON.stringify(reference()):data[key]);
  }
}));
test('rejects direct reused file identity, even for valid hash metadata',async()=>fixture(async paths=>{
  assert.equal((await verifyReferenceEvidence({...paths,rawQuery:paths.rawSource})).reason,'REUSED_FILE');
}));
test('rejects symlink and directory evidence',async()=>fixture(async(paths,dir)=>{
  const linked=join(dir,'linked.txt'); await symlink(paths.rawQuery,linked);
  assert.equal((await verifyReferenceEvidence({...paths,rawQuery:linked})).reason,'UNSAFE_FILE');
  const folder=join(dir,'folder');await mkdir(folder);
  assert.equal((await verifyReferenceEvidence({...paths,rawQuery:folder})).reason,'UNSAFE_FILE');
}));
test('caps JSON, original response, query and normalizer source sizes',async()=>fixture(async paths=>{
  for(const [key,size] of [['reference',128*1024+1],['rawSource',32*1024*1024+1],
    ['rawQuery',128*1024+1],['normalizerSource',1024*1024+1]]) {
    const original=await readFile(paths[key]);
    await writeFile(paths[key],Buffer.alloc(size,65));
    assert.equal((await verifyReferenceEvidence(paths)).reason,'UNSAFE_FILE');
    await writeFile(paths[key],original);
  }
}));
test('rejects fake claimed source, unpinned SHA and extra provenance',async()=>fixture(async paths=>{
  for(const mutate of [
    p=>p.source='Other',p=>p.rawResponseSha256='A'.repeat(64),
    p=>p.querySha256='missing',p=>p.normalizationCodeSha256='',
    p=>p.unexpected='file:///private',p=>p.normalizationNotes='short',
  ]) {
    const obj=reference();mutate(obj.provenance);
    await writeFile(paths.reference,JSON.stringify(obj));
    assert.equal((await verifyReferenceEvidence(paths)).reason,'INVALID_PROVENANCE');
  }
}));
test('rejects malformed normalized reference and missing provenance',async()=>fixture(async paths=>{
  await writeFile(paths.reference,'not-json');
  assert.equal((await verifyReferenceEvidence(paths)).reason,'INVALID_REFERENCE');
  await writeFile(paths.reference,JSON.stringify({schemaVersion:1}));
  assert.equal((await verifyReferenceEvidence(paths)).reason,'INVALID_PROVENANCE');
}));
test('invalid path maps and blank paths fail without reading arbitrary files',async()=>fixture(async paths=>{
  for(const input of [null,{}, {...paths,rawSource:''},
    {...paths,extra:'unexpected'}, {...paths,rawQuery:null}]) {
    assert.equal((await verifyReferenceEvidence(input)).status,'EVIDENCE_REJECTED');
  }
}));
test('strict CLI requires four distinct switches in any order',()=>{
  const args=['--raw-query','q.txt','--reference','r.json',
    '--normalizer-source','c.py','--raw-source','raw.txt'];
  assert.deepEqual(parseEvidenceArgs(args),{
    reference:'r.json',rawSource:'raw.txt',rawQuery:'q.txt',normalizerSource:'c.py',
  });
  for(const invalid of [[],args.slice(0,6),['--raw-query','q.txt','--raw-query','q2',...args.slice(4)],
    ['--bad','q.txt',...args.slice(2)],args.map(x=>x==='q.txt'?'--bad':x)]) {
    assert.equal(parseEvidenceArgs(invalid),null);
  }
});
test('CLI exit zero is explicitly not a validation certificate and never leaks paths',async()=>fixture(async paths=>{
  const script=new URL('../scripts/ephemeris/verify-reference-evidence.mjs',import.meta.url);
  const args=['--reference',paths.reference,'--raw-source',paths.rawSource,
    '--raw-query',paths.rawQuery,'--normalizer-source',paths.normalizerSource];
  const proc=spawnSync(process.execPath,[script.pathname,...args],{encoding:'utf8'});
  assert.equal(proc.status,0,proc.stderr);
  assert.match(proc.stdout,/EVIDENCE_BYTES_MATCH/);
  assert.match(proc.stdout,/no JPL authentication/);
  assert.doesNotMatch(proc.stdout+proc.stderr,/vs-reference-evidence-|COMMAND=|fictional_only=1/);
}));
test('CLI rejects tampered query without printing local paths or source text',async()=>fixture(async paths=>{
  await writeFile(paths.rawQuery,'private-raw-birth-data');
  const script=new URL('../scripts/ephemeris/verify-reference-evidence.mjs',import.meta.url);
  const args=['--reference',paths.reference,'--raw-source',paths.rawSource,
    '--raw-query',paths.rawQuery,'--normalizer-source',paths.normalizerSource];
  const proc=spawnSync(process.execPath,[script.pathname,...args],{encoding:'utf8'});
  assert.equal(proc.status,1);
  assert.match(proc.stderr,/EVIDENCE_DIGEST_MISMATCH/);
  assert.doesNotMatch(proc.stdout+proc.stderr,/vs-reference-evidence-|private-raw-birth-data|COMMAND=/);
}));
