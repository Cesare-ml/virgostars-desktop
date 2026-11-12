import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPERIMENTAL_BODIES, REQUIRED_APPROXIMATIONS } from '../src/app/native/experimental-sky-contract.ts';
import { angularDifferenceDegrees, compareExperimentalToReference, referenceShapeValid, PROVISIONAL_LIMITS } from '../scripts/ephemeris/de441-reference-check.mjs';

const utcIso='2026-11-12T17:01:02.000Z';
function snapshot() {
  return {
    schemaVersion:1,scientificStatus:'experimental_unverified',provider:'VirgoStars-Ephemeris',
    sourceFormat:'DE441_classic_binary',kernelSha256:'a'.repeat(64),utcIso,latMicro:44123456,
    lngMicro:11345678,heightMeters:120,observerDatum:'WGS84',
    frame:'mean_ecliptic_and_equatorial_of_date',geometry:'topocentric_geometric',
    ttJulianDay:2460997.209,tdbJulianDay:2460997.209,taiMinusUtcSeconds:37,
    approximations:[...REQUIRED_APPROXIMATIONS],
    positions:EXPERIMENTAL_BODIES.map((bodyId,i)=>({bodyId,
      centerKind:bodyId.endsWith('_barycenter')?'system_barycenter':'body_center',
      longitudeDeg:(i*31)%360, latitudeDeg:-12,rightAscensionDeg:(i*32)%360,
      declinationDeg:14, altitudeDeg:-23,azimuthDeg:140,distanceKm:1000000+i*1000})),
  };
}
function reference(s=snapshot()) {
  return {schemaVersion:1, sourceKind:'NAIF_SPICE',sourceId:'NAIF_SPICE_2026_v01',
    sourceDocumentSha256:'b'.repeat(64),transformMethodId:'NAIF_J2000_TO_MEAN_DATE_v1',
    utcIso:s.utcIso,latMicro:s.latMicro,lngMicro:s.lngMicro,heightMeters:s.heightMeters,
    observerDatum:s.observerDatum,frame:s.frame,geometry:s.geometry,
    positions:s.positions.map(p=>({...p}))};
}
const check=(s,r)=>compareExperimentalToReference(s,r);

test('synthetic self-match is only within provisional limits, NEVER scientifically validated',()=>{
  const s=snapshot(),r=reference(s);assert.equal(referenceShapeValid(r,s),true);
  const result=check(s,r);assert.equal(result.kind,'within_provisional_tolerance');
  assert.equal(result.failures.length,0);
  assert.ok(Object.values(result.maximum).every(x=>x===0));
});
test('0/360 longitude and right-ascension seams use minimal circular distance',()=>{
  assert.ok(Math.abs(angularDifferenceDegrees(359.999,0.001)-0.002)<1e-10);
  assert.ok(Math.abs(angularDifferenceDegrees(0.001,359.999)-0.002)<1e-10);
  const s=snapshot(),r=reference(s);s.positions[0].longitudeDeg=359.99995;
  r.positions[0].longitudeDeg=0.00005;
  s.positions[0].rightAscensionDeg=359.99995;r.positions[0].rightAscensionDeg=0.00005;
  assert.equal(check(s,r).kind,'within_provisional_tolerance');
});
test('angular mismatch is recorded by body and field, with no private file path',()=>{
  const s=snapshot(),r=reference(s);s.positions[2].longitudeDeg+=0.1;
  const out=check(s,r);assert.equal(out.kind,'mismatch');
  assert.deepEqual(out.failures,[{bodyId:'mercury',field:'longitudeDeg'}]);
  assert.ok(out.maximum.longitudeDeg>0.09);
});
test('latitude/declination use straight differences, never circular wrap',()=>{
  const s=snapshot(),r=reference(s);s.positions[0].latitudeDeg=89;
  r.positions[0].latitudeDeg=-89;
  assert.equal(check(s,r).kind,'mismatch');
  assert.ok(check(s,r).maximum.latitudeDeg>170);
});
test('distance is compared in kilometers and has a finite fixed review limit',()=>{
  const s=snapshot(),r=reference(s);
  assert.equal(PROVISIONAL_LIMITS.distanceKm,10);
  s.positions[0].distanceKm+=11;
  const v=check(s,r);assert.equal(v.kind,'mismatch');
  assert.deepEqual(v.failures,[{bodyId:'sun',field:'distanceKm'}]);
});
test('altitude and azimuth have separate provisional thresholds, singular azimuth must match null',()=>{
  const s=snapshot(),r=reference(s);
  s.positions[3].altitudeDeg+=0.004;
  s.positions[3].azimuthDeg=null;
  const out=check(s,r);
  assert.deepEqual(out.failures,[{bodyId:'venus',field:'altitudeDeg'},{bodyId:'venus',field:'azimuthDeg'}]);
  r.positions[3].azimuthDeg=null;
  assert.equal(check(s,r).failures.length,1);
});
test('reference cannot masquerade as apparent/other frame, observer or epoch',()=>{
  const s=snapshot();for(const [key,value] of [
    ['frame','true_ecliptic_of_date'],['geometry','apparent'],['observerDatum','WGS84_unknown'],
    ['utcIso','2026-11-12T17:01:03.000Z'],['latMicro',0],['lngMicro',0],['heightMeters',0],
  ]){const r=reference(s);r[key]=value;assert.equal(check(s,r).kind,'invalid_input',key)}
});
test('provenance must be independently attributed and fingerprint-shaped, but is not proof',()=>{
  const s=snapshot();for(const [key,value] of [
    ['sourceKind','VirgoStars-Ephemeris'],['sourceKind','Unknown'],
    ['sourceDocumentSha256','/private/data'],['sourceDocumentSha256','z'.repeat(64)],
    ['sourceId',''],['transformMethodId',''],
  ]){const r=reference(s);r[key]=value;assert.equal(check(s,r).kind,'invalid_input',key)}
});
test('missing, duplicated, renamed bodies and center-kind mismatches are rejected',()=>{
  const s=snapshot();for(const mutate of [
    r=>r.positions.pop(),r=>r.positions[1]={...r.positions[0]},
    r=>r.positions[1].bodyId='earth',r=>r.positions[4].centerKind='body_center',
  ]){const r=reference(s);mutate(r);assert.equal(check(s,r).kind,'invalid_input')}
});
test('unbounded, NaN or missing numeric reference values fail closed',()=>{
  const s=snapshot();for(const mutate of [
    r=>r.positions[0].distanceKm=-1,r=>r.positions[0].longitudeDeg=360,
    r=>r.positions[0].rightAscensionDeg=NaN,
    r=>r.positions[0].altitudeDeg=Infinity,r=>delete r.positions[0].distanceKm,
  ]){const r=reference(s);mutate(r);assert.equal(check(s,r).kind,'invalid_input')}
});
test('unexpected fields (especially paths/metadata) are rejected',()=>{
  const s=snapshot();for(const mutate of [
    r=>r.secret='yes',r=>r.positions[0].kernelPath='private',r=>r.schemaVersion=2,
  ]){const r=reference(s);mutate(r);assert.equal(check(s,r).kind,'invalid_input')}
});
test('malformed input never throws or produces a false PASS',()=>{
  for(const v of [null,undefined,[],{},1,'string']){
    assert.equal(check(v,v).kind,'invalid_input');
    assert.equal(check(snapshot(),v).kind,'invalid_input');
  }
});
test('CLI checks real parsed JSON, masks private paths and returns fixed status',()=>{
  const dir=mkdtempSync(join(tmpdir(),'vs-ephem-ref-'));
  const a=join(dir,'private-de441-result.json'),b=join(dir,'private-independent-reference.json');
  const cli=fileURLToPath(new URL('../scripts/ephemeris/verify-de441-reference.mjs',import.meta.url));
  try {
    const s=snapshot(),r=reference(s);
    writeFileSync(a,JSON.stringify(s));writeFileSync(b,JSON.stringify(r));
    const run=()=>spawnSync(process.execPath,['--experimental-strip-types',cli,a,b],{encoding:'utf8',timeout:10000});
    const pass=run();assert.equal(pass.status,0,pass.stderr);
    assert.match(pass.stdout,/WITHIN_PROVISIONAL_LIMITS_REVIEW_ONLY/);
    s.positions[0].longitudeDeg+=1;writeFileSync(a,JSON.stringify(s));
    const fail=run();assert.equal(fail.status,1);assert.match(fail.stderr,/MISMATCH count=1/);
    r.geometry='apparent';writeFileSync(b,JSON.stringify(r));
    const invalid=run();assert.equal(invalid.status,2);assert.match(invalid.stderr,/INVALID_INPUT/);
    for(const out of [pass,fail,invalid])assert.equal((out.stdout+out.stderr).includes(dir),false);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('CLI refuses missing files and excessive JSON without printing source data',()=>{
  const dir=mkdtempSync(join(tmpdir(),'vs-ref-large-'));
  const cli=fileURLToPath(new URL('../scripts/ephemeris/verify-de441-reference.mjs',import.meta.url));
  try {
    const a=join(dir,'large.json');writeFileSync(a,'SENSITIVE'.repeat(60000));
    const p=spawnSync(process.execPath,['--experimental-strip-types',cli,a,join(dir,'missing.json')],{encoding:'utf8',timeout:10000});
    assert.equal(p.status,2);assert.match(p.stderr,/INVALID_INPUT/);
    assert.equal((p.stdout+p.stderr).includes(dir),false);
    assert.equal((p.stdout+p.stderr).includes('SENSITIVE'),false);
  } finally {rmSync(dir,{recursive:true,force:true});}
});


test('reference CLI refuses symlink input even when target contains a valid fixture',t=>{
  const dir=mkdtempSync(join(tmpdir(),'vs-ref-symlink-'));
  const real=join(dir,'private-real-snapshot.json');
  const link=join(dir,'private-symlink.json');
  const ref=join(dir,'reference.json');
  const cli=fileURLToPath(new URL('../scripts/ephemeris/verify-de441-reference.mjs',import.meta.url));
  try {
    const s=snapshot();
    writeFileSync(real,JSON.stringify(s));
    writeFileSync(ref,JSON.stringify(reference(s)));
    try { symlinkSync(real,link,'file'); }
    catch (err) {
      if (err?.code==='EPERM'||err?.code==='EACCES') {t.skip('Symlink creation requires OS permission');return;}
      throw err;
    }
    const p=spawnSync(process.execPath,['--experimental-strip-types',cli,link,ref],
      {encoding:'utf8',timeout:2500});
    assert.equal(p.error,undefined);
    assert.equal(p.status,2);
    assert.match(p.stderr,/DE441_REFERENCE:INVALID_INPUT/);
    assert.equal((p.stdout+p.stderr).includes(dir),false);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('reference CLI rejects named pipes without blocking on open',{
  skip:process.platform==='win32',
},t=>{
  const dir=mkdtempSync(join(tmpdir(),'vs-ref-fifo-'));
  const fifo=join(dir,'private-named-pipe');
  const ref=join(dir,'reference.json');
  const cli=fileURLToPath(new URL('../scripts/ephemeris/verify-de441-reference.mjs',import.meta.url));
  try {
    const mk=spawnSync('mkfifo',[fifo],{encoding:'utf8',timeout:2500});
    if (mk.error?.code==='ENOENT') {t.skip('mkfifo unavailable');return;}
    assert.equal(mk.status,0);
    writeFileSync(ref,JSON.stringify(reference()));
    const p=spawnSync(process.execPath,['--experimental-strip-types',cli,fifo,ref],
      {encoding:'utf8',timeout:2500});
    assert.equal(p.error,undefined,'FIFO open must not hang');
    assert.equal(p.status,2);
    assert.match(p.stderr,/DE441_REFERENCE:INVALID_INPUT/);
    assert.equal((p.stdout+p.stderr).includes(dir),false);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('reference CLI refuses a directory and invalid UTF-8 without leaking contents',()=>{
  const dir=mkdtempSync(join(tmpdir(),'vs-ref-nonfile-'));
  const malformed=join(dir,'private-invalid-utf8.json');
  const referenceFile=join(dir,'reference.json');
  const cli=fileURLToPath(new URL('../scripts/ephemeris/verify-de441-reference.mjs',import.meta.url));
  try {
    const s=snapshot(),r=reference(s);
    writeFileSync(referenceFile,JSON.stringify(r));
    const validBytes=Buffer.from(JSON.stringify(s));
    // Add a malformed UTF-8 codepoint in whitespace outside quoted strings.
    // Fatal decoding rejects the bytes before JSON.parse sees any content.
    writeFileSync(malformed,Buffer.concat([validBytes,Buffer.from([0xc3,0x28])]));
    for(const path of [dir,malformed]) {
      const p=spawnSync(process.execPath,['--experimental-strip-types',cli,path,referenceFile],
        {encoding:'utf8',timeout:2500});
      assert.equal(p.error,undefined);
      assert.equal(p.status,2);
      assert.match(p.stderr,/DE441_REFERENCE:INVALID_INPUT/);
      assert.equal((p.stdout+p.stderr).includes(dir),false);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});
