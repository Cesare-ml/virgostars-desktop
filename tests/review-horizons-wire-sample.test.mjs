import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectWire12VectorSample, readSampleOnce, reviewWire12Sample, parseReviewArgs }
  from '../scripts/ephemeris/review-horizons-wire-sample.mjs';
const jd='2460000.500000';
const fixture=()=>[
  'API VERSION: 1.2','API SOURCE: NASA/JPL Horizons API','',
  'Ephemeris / WWW_USER / FICTIONAL test only',
  'Target body name: Test Sun (10) {source: de441}',
  'Center body name: Solar System Barycenter (0) {source: DE441}',
  'Center-site name: BODY CENTER','Output units: KM-S',
  'Output type: GEOMETRIC cartesian states',
  'Output format: 2 (position and velocity)',
  'Reference frame: ICRF/J2000.0',
  'Coordinate systm: Earth Mean Equator and Equinox of Reference Epoch',
  'Start time: A.D. 2023-Feb-25 00:00:00.0000 TDB',
  'JDTDB, Calendar Date (TDB), X, Y, Z, VX, VY, VZ',
  '$$SOE',
  '2460000.500000000, A.D. 2023-Feb-25 00:00:00.0000, 1.2E+07, -2.3E+06, 3.2E+05, 1.2E+01, -4.5E+00, 0.0E+00,',
  '$$EOE','','Fictional sample only; NOT NASA/JPL source authenticated','',
].join('\n');
const analyze=(raw=fixture(),body='sun',j=jd)=>inspectWire12VectorSample(raw,body,j);
const replace=(a,b)=>fixture().replace(a,()=>b);
async function temp(fn){const root=await mkdtemp(join(tmpdir(),'vs-wire12-review-'));
  try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}

test('valid synthetic wire 1.2 skeleton is REVIEWABLE, never validated or approved',()=>{
  assert.deepEqual(analyze(),{
    status:'WIRE_1_2_STRUCTURE_REVIEWABLE_UNVERIFIED',scientificallyValidated:false,
    sourceAuthenticated:false,vectorFormatApproved:false,comparisonReady:false,
  });
});
test('wire 1.0 or wire 1.3 is not silently accepted',()=>{
  for(const v of ['1.0','1.3'])assert.equal(analyze(replace('API VERSION: 1.2','API VERSION: '+v)).status,'NOT_WIRE_1_2_TEXT');
});
test('wrong source or missing transport envelope is refused',()=>{
  for(const bad of [replace('NASA/JPL Horizons API','Other service'),' '+fixture(),
    replace('API VERSION: 1.2\n','')])assert.equal(analyze(bad).status,'NOT_WIRE_1_2_TEXT');
});
test('wrong target or unexpected request body is rejected',()=>{
  assert.equal(analyze(fixture(),'moon').status,'WRONG_TARGET');
  assert.equal(analyze(fixture(),'earth').status,'INVALID_REVIEW_REQUEST');
});
test('wrong reference origin and time model are rejected',()=>{
  for(const [a,b] of [['Solar System Barycenter (0)','Earth (399)'],
      ['Reference frame: ICRF/J2000.0','Reference frame: ECLIPTIC'],
      ['Output units: KM-S','Output units: AU-D'],
      ['GEOMETRIC cartesian states','ASTROMETRIC cartesian states'],
      ['00:00:00.0000 TDB','00:00:00.0000 UT']])
    assert.equal(analyze(replace(a,b)).status,'MODEL_MISMATCH',a);
});
test('double target or two coordinate-header aliases are rejected',()=>{
  for(const h of ['Target body name: Moon (301)',
    'Coordinate system: Earth Mean Equator and Equinox of Reference Epoch']){
    const bad=fixture().replace('$$SOE',()=>h+'\n$$SOE');
    assert.equal(analyze(bad).status,'MALFORMED_OR_AMBIGUOUS_HEADERS');
  }
});
test('footer may not supply a missing target header',()=>{
  const raw=fixture().replace('Target body name: Test Sun (10) {source: de441}\n','') +
    '\nTarget body name: Test Sun (10)';
  assert.equal(analyze(raw).status,'MALFORMED_OR_AMBIGUOUS_HEADERS');
});
test('duplicate or missing SOE/EOE marker is rejected',()=>{
  for(const bad of [replace('$$SOE','$$SOE\n$$SOE'),replace('$$EOE','')])
    assert.equal(analyze(bad).status,'UNRECOGNIZED_VECTOR_TABLE');
  assert.equal(analyze(replace('$$SOE','')).status,'MALFORMED_OR_AMBIGUOUS_HEADERS');
});
test('multiple records or malformed CSV are rejected',()=>{
  const extra=fixture().replace('$$EOE',()=> '2460000.500000000, A.D. 2023-Feb-25 00:00:00.0000, 1, 2, 3, 4, 5, 6,\n$$EOE');
  assert.equal(analyze(extra).status,'UNRECOGNIZED_VECTOR_TABLE');
  assert.equal(analyze(replace('1.2E+07','NaN')).status,'UNRECOGNIZED_VECTOR_TABLE');
  assert.equal(analyze(replace('1.2E+07, -2.3E+06','1.2E+07')).status,'UNRECOGNIZED_VECTOR_TABLE');
});
test('record time must match reviewed independent TDB Julian day',()=>{
  assert.equal(analyze(replace('2460000.500000000','2460001.500000000')).status,'EPOCH_MISMATCH');
});
test('unknown, malformed, oversize or impossible request is refused',()=>{
  assert.equal(analyze(fixture(),'sun','2026-11-13').status,'INVALID_REVIEW_REQUEST');
  assert.equal(analyze(fixture()+'x'.repeat(512*1024)).status,'NOT_WIRE_1_2_TEXT');
  assert.equal(analyze(null).status,'NOT_WIRE_1_2_TEXT');
});
test('manual CLI parser rejects unknown, extra or duplicate switches',()=>{
  assert.deepEqual(parseReviewArgs(['--file','one.txt','--body','sun','--tdb-jd',jd]),
    {path:'one.txt',bodyId:'sun',jd});
  for(const args of [[],['--file','x'],['--file','x','--file','x','--body','sun'],
      ['--file','x','--body','sun','--tdb-jd','2026-11-13'],
      ['--file','x','--body','earth','--tdb-jd',jd],
      ['--file','x','--body','sun','--foo',jd]])assert.equal(parseReviewArgs(args),null);
});
test('reads only regular unchanged original file, no writes',async()=>temp(async root=>{
  const path=join(root,'response.txt'),raw=fixture();await writeFile(path,raw);
  assert.equal(await readSampleOnce(path),raw);
  assert.equal((await reviewWire12Sample(path,'sun',jd)).status,'WIRE_1_2_STRUCTURE_REVIEWABLE_UNVERIFIED');
  assert.equal(await readFile(path,'utf8'),raw);
}));
test('refuses symlinks even if they contain valid fake vector text',async()=>temp(async root=>{
  const target=join(root,'original.txt'),link=join(root,'link.txt');
  await writeFile(target,fixture());await symlink(target,link);
  assert.equal((await reviewWire12Sample(link,'sun',jd)).status,'UNSAFE_OR_UNREADABLE_SAMPLE');
}));
test('invalid UTF8 or oversized files fail without leaking contents',async()=>temp(async root=>{
  const path=join(root,'response.txt');
  await writeFile(path,Buffer.from([0xc3,0x28]));
  assert.equal((await reviewWire12Sample(path,'sun',jd)).status,'UNSAFE_OR_UNREADABLE_SAMPLE');
  await writeFile(path,'x'.repeat(512*1024+1));
  assert.equal((await reviewWire12Sample(path,'sun',jd)).status,'UNSAFE_OR_UNREADABLE_SAMPLE');
}));
test('CLI prints fixed sanitized result, no paths, times, numerical components',async()=>temp(async root=>{
  const path=join(root,'private-epoch-sample.txt');await writeFile(path,fixture());
  const script=fileURLToPath(new URL('../scripts/ephemeris/review-horizons-wire-sample.mjs',import.meta.url));
  const proc=spawnSync(process.execPath,[script,'--file',path,'--body','sun','--tdb-jd',jd],{encoding:'utf8'});
  assert.equal(proc.status,0,proc.stderr);
  assert.equal(proc.stdout,'HORIZONS_WIRE12_REVIEW:WIRE_1_2_STRUCTURE_REVIEWABLE_UNVERIFIED\n');
  assert.ok(!proc.stdout.includes(jd) && !proc.stdout.includes(root));
  const rejected=spawnSync(process.execPath,[script,'--file',path,'--body','sun','--bad',jd],{encoding:'utf8'});
  assert.equal(rejected.status,1);assert.equal(rejected.stdout,'HORIZONS_WIRE12_REVIEW:INVALID_REVIEW_REQUEST\n');
}));
