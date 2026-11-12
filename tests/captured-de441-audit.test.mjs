/**
 * True three-module offline integration: all production filesystem readers and
 * numerical comparison are called, with fictional geometries and local files.
 * A passing fixture is NOT independent astronomy or source authentication.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVerifiedAuditArgs } from '../scripts/ephemeris/run-verified-de441-audit.mjs';
import { runCapturedDe441Audit } from '../scripts/ephemeris/run-captured-de441-audit.mjs';



const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bodies = [
  'sun','moon','mercury','venus','mars_barycenter','jupiter_barycenter',
  'saturn_barycenter','uranus_barycenter','neptune_barycenter','pluto_barycenter',
];
const approximations = [
  'ut1_equals_utc','truncated_tdb_minus_tt','no_nutation','no_light_time',
  'no_aberration','no_gravitational_deflection','no_polar_motion',
  'no_atmospheric_refraction','outer_planet_system_barycenters',
];
const source = 'FICTITIOUS Horizons-like response. This is NOT a JPL download.\n';
const query = 'TEST_ONLY=true&COMMAND=FICTITIOUS&CENTER=FICTITIOUS\n';
const normalizer = '# FICTITIOUS non-astronomical test normalizer.\n';
const sciNote = 'Fictional self-consistent comparison only; NOT authentic JPL reference.';
const tolerance = {maxDirectionArcsec:1,maxDistancePpm:1,maxEpochSeconds:0.1};

function sky() {
  return {
    schemaVersion:1,
    utcIso:'2026-11-12T10:00:00.000Z',latMicro:44000000,lngMicro:11000000,
    heightMeters:123,observerDatum:'WGS84',frame:'mean_ecliptic_and_equatorial_of_date',
    geometry:'topocentric_geometric',ttJulianDay:2460997.0007,
    tdbJulianDay:2460997.0007,taiMinusUtcSeconds:37,
    approximations:[...approximations],
    positions:bodies.map((bodyId,i)=>({bodyId,
      centerKind:bodyId.endsWith('_barycenter')?'system_barycenter':'body_center',
      longitudeDeg:i*32+1,latitudeDeg:2,
      rightAscensionDeg:i*33+1,declinationDeg:4,
      altitudeDeg:25,azimuthDeg:35,
      distanceKm:100000000+i*5000,
    })),
  };
}
function syntheticDocuments() {
  const common=sky();
  return {
    actual:{...structuredClone(common),scientificStatus:'experimental_unverified',
      provider:'VirgoStars-Ephemeris',sourceFormat:'DE441_classic_binary',kernelSha256:'a'.repeat(64)},
    reference:{...structuredClone(common),provenance:{
      source:'JPL_HORIZONS',rawResponseSha256:sha(source),querySha256:sha(query),
      normalizationCodeSha256:sha(normalizer),normalizationNotes:sciNote,
    }},
  };
}
async function fixture(run) {
  const folder=await mkdtemp(join(tmpdir(),'vs-de441-real-e2e-'));
  const paths={
    actual:join(folder,'fictional-actual.json'),
    reference:join(folder,'fictional-reference.json'),
    rawSource:join(folder,'fictional-source.txt'),
    rawQuery:join(folder,'fictional-query.txt'),
    normalizerSource:join(folder,'fictional-normalizer.py'),
  };
  const docs=syntheticDocuments();
  try {
    await Promise.all([
      writeFile(paths.actual,JSON.stringify(docs.actual)),
      writeFile(paths.reference,JSON.stringify(docs.reference)),
      writeFile(paths.rawSource,source),writeFile(paths.rawQuery,query),
      writeFile(paths.normalizerSource,normalizer),
    ]);
    await run(paths,docs,folder);
  } finally { await rm(folder,{force:true,recursive:true}); }
}
function args(paths) {
  return [
    '--actual',paths.actual,'--reference',paths.reference,'--raw-source',paths.rawSource,
    '--raw-query',paths.rawQuery,'--normalizer-source',paths.normalizerSource,
    '--max-direction-arcsec',String(tolerance.maxDirectionArcsec),
    '--max-distance-ppm',String(tolerance.maxDistancePpm),
    '--max-epoch-seconds',String(tolerance.maxEpochSeconds),
  ];
}
const audit = paths => runCapturedDe441Audit(parseVerifiedAuditArgs(args(paths)));
const script=fileURLToPath(new URL('../scripts/ephemeris/run-captured-de441-audit.mjs',import.meta.url));
const cli = paths => spawnSync(process.execPath,[script,...args(paths)],{encoding:'utf8',maxBuffer:65536});
const noLeaks = (processResult,paths) => {
  const output=processResult.stdout+processResult.stderr;
  for(const value of Object.values(paths)) assert.ok(!output.includes(value),'input path leaked');
  assert.ok(!output.includes('44000000'),'coordinates leaked');
  assert.ok(!output.includes('2026-11-12T10:00'),'timestamp leaked');
  assert.ok(!output.includes('FICTITIOUS'),'raw source leaked');
};


test('captured audit compares complete fictional evidence with original in-memory values', async()=>fixture(async paths=>{
  assert.deepEqual(await audit(paths),{
    status:'CAPTURED_WITHIN_TOLERANCE_EXPERIMENTAL',maxDirectionArcsec:0,
    maxDistancePpm:0,maxEpochSeconds:0,scientificallyValidated:false,
  });
}));

test('CLI verifies the same fictional inputs and prints no file paths',async()=>fixture(async paths=>{
  const result=cli(paths);
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/CAPTURED_WITHIN_TOLERANCE_EXPERIMENTAL/);
  noLeaks(result,paths);
}));

test('numerical disagreement correctly fails with experimental-only result',async()=>fixture(async(paths,docs)=>{
  docs.actual.positions[0].longitudeDeg+=0.3;
  await writeFile(paths.actual,JSON.stringify(docs.actual));
  const result=await audit(paths);
  assert.equal(result.status,'CAPTURED_OUTSIDE_TOLERANCE_EXPERIMENTAL');
  assert.ok(result.maxDirectionArcsec>100);
  assert.equal(result.scientificallyValidated,false);
}));

test('CLI exits nonzero on numerical disagreement without exposing individual coordinates',async()=>fixture(async(paths,docs)=>{
  docs.actual.positions[0].rightAscensionDeg+=0.6;
  await writeFile(paths.actual,JSON.stringify(docs.actual));
  const result=cli(paths);
  assert.equal(result.status,1);
  assert.match(result.stdout,/CAPTURED_OUTSIDE_TOLERANCE_EXPERIMENTAL/);
  noLeaks(result,paths);
}));

test('source, query and normalizer digests are each required',async()=>fixture(async paths=>{
  for (const [key,newValue] of [['rawSource','altered response'],['rawQuery','altered query'],['normalizerSource','altered normalizer']]) {
    const original=await readFile(paths[key]);
    await writeFile(paths[key],newValue);
    assert.equal((await audit(paths)).reason,'EVIDENCE_REJECTED',key);
    await writeFile(paths[key],original);
  }
}));

test('source metadata cannot forge provenance or certify an experimental result',async()=>fixture(async(paths,docs)=>{
  docs.reference.provenance.source='untrusted source';
  await writeFile(paths.reference,JSON.stringify(docs.reference));
  assert.equal((await audit(paths)).reason,'EVIDENCE_REJECTED');
  docs.reference.provenance.source='JPL_HORIZONS';
  docs.actual.scientificStatus='validated';
  await Promise.all([writeFile(paths.actual,JSON.stringify(docs.actual)),writeFile(paths.reference,JSON.stringify(docs.reference))]);
  assert.equal((await audit(paths)).reason,'COMPARISON_INVALID');
}));

test('observer and frame mismatch fail rather than combining incompatible astronomy',async()=>fixture(async(paths,docs)=>{
  docs.reference.frame='true_of_date';
  await writeFile(paths.reference,JSON.stringify(docs.reference));
  assert.equal((await audit(paths)).reason,'COMPARISON_INVALID');
  docs.reference.frame='mean_ecliptic_and_equatorial_of_date';
  docs.reference.latMicro+=1;
  await writeFile(paths.reference,JSON.stringify(docs.reference));
  assert.equal((await audit(paths)).reason,'COMPARISON_INVALID');
}));

test('all five files must be distinct even if the same hardlink has matching bytes',async()=>fixture(async(paths,_docs,folder)=>{
  const {link}=await import('node:fs/promises');
  const hardlink=join(folder,'duplicate-actual.json');
  await link(paths.actual,hardlink);
  assert.equal((await audit({...paths,reference:hardlink})).reason,'REUSED_INPUT_FILE');
}));

test('symlink and missing experimental input fail closed',async()=>fixture(async(paths,_docs,folder)=>{
  const linked=join(folder,'sky-symlink.json');
  await symlink(paths.actual,linked);
  assert.equal((await audit({...paths,actual:linked})).reason,'UNSAFE_INPUT_FILE');
  await rm(paths.actual);
  assert.equal((await audit(paths)).reason,'UNSAFE_INPUT_FILE');
}));

test('malformed JSON from captured actual is rejected without throwing user data',async()=>fixture(async paths=>{
  await writeFile(paths.actual,'{ private user payload');
  assert.deepEqual(await audit(paths),{
    status:'CAPTURED_AUDIT_BLOCKED',reason:'INVALID_JSON',scientificallyValidated:false,
  });
}));

test('invalid UTF-8 from the captured actual is rejected',async()=>fixture(async paths=>{
  await writeFile(paths.actual,Buffer.from([0xc3,0x28]));
  assert.equal((await audit(paths)).reason,'INVALID_JSON');
}));

test('invalid UTF-8 from reference JSON is rejected by D-05 provenance validator',async()=>fixture(async paths=>{
  await writeFile(paths.reference,Buffer.from([0xc3,0x28]));
  assert.equal((await audit(paths)).reason,'EVIDENCE_REJECTED');
}));

test('oversized actual and original reference response are refused',async()=>fixture(async paths=>{
  await writeFile(paths.actual,Buffer.alloc(128*1024+1,65));
  assert.equal((await audit(paths)).reason,'UNSAFE_INPUT_FILE');
  const docs=syntheticDocuments();
  await writeFile(paths.actual,JSON.stringify(docs.actual));
  await writeFile(paths.rawSource,Buffer.alloc(32*1024*1024+1,65));
  assert.equal((await audit(paths)).reason,'UNSAFE_INPUT_FILE');
}));

test('strict argument parser prevents missing controls before any reader is invoked',async()=>{
  assert.equal((await runCapturedDe441Audit(null)).reason,'INVALID_ARGUMENTS');
  assert.equal((await runCapturedDe441Audit({evidence:{},comparison:{actual:'x',reference:'a',rawSource:'b'}})).reason,'INVALID_ARGUMENTS');
});

test('CLI rejects an edited source without printing paths or supplied private input',async()=>fixture(async paths=>{
  await writeFile(paths.rawQuery,'secret test birth values');
  const result=cli(paths);
  assert.equal(result.status,1);
  assert.match(result.stdout,/CAPTURED_AUDIT_BLOCKED/);
  assert.doesNotMatch(result.stdout+result.stderr,/secret test birth values/);
  noLeaks(result,paths);
}));
