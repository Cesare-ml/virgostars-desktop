import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  compareExperimentalSky, sphericalSeparationArcsec, parseComparisonArgs, auditLocalReference,
} from '../scripts/ephemeris/compare-de441-reference.mjs';

const IDS = [
  'sun', 'moon', 'mercury', 'venus', 'mars_barycenter', 'jupiter_barycenter',
  'saturn_barycenter', 'uranus_barycenter', 'neptune_barycenter', 'pluto_barycenter',
];
const LIMITATIONS = [
  'ut1_equals_utc','truncated_tdb_minus_tt','no_nutation','no_light_time',
  'no_aberration','no_gravitational_deflection','no_polar_motion',
  'no_atmospheric_refraction','outer_planet_system_barycenters',
];
const raw = Buffer.from('Synthetic JPL Horizons-shaped fixture; NOT real Horizons astronomy.\n');
const sha = createHash('sha256').update(raw).digest('hex');
const tol = Object.freeze({maxDirectionArcsec:10,maxDistancePpm:1,maxEpochSeconds:0.01});
const fictionalPositions = () => IDS.map((bodyId,i)=>({
  bodyId,centerKind:bodyId.endsWith('_barycenter')?'system_barycenter':'body_center',
  longitudeDeg:(i*35)%360,latitudeDeg:3,rightAscensionDeg:(i*34)%360,
  declinationDeg:-2,altitudeDeg:15,azimuthDeg:20,distanceKm:100_000_000+i*1_000,
}));
function fixtures() {
  const shared = {
    schemaVersion:1,utcIso:'2026-11-12T12:00:00.000Z',latMicro:44_123_456,
    lngMicro:11_345_678,heightMeters:120,observerDatum:'WGS84',
    frame:'mean_ecliptic_and_equatorial_of_date',geometry:'topocentric_geometric',
    ttJulianDay:2460997.0007,tdbJulianDay:2460997.0007,taiMinusUtcSeconds:37,
    approximations:[...LIMITATIONS],positions:fictionalPositions(),
  };
  return {
    actual:{...structuredClone(shared),scientificStatus:'experimental_unverified',
      provider:'VirgoStars-Ephemeris',sourceFormat:'DE441_classic_binary',kernelSha256:'a'.repeat(64)},
    reference:{...structuredClone(shared),provenance:{
      source:'JPL_HORIZONS',rawResponseSha256:sha,querySha256:'b'.repeat(64),
      normalizationCodeSha256:'c'.repeat(64),
      normalizationNotes:'Synthetic independent conversion fixture, NOT an actual Horizons export',
    }},
  };
}
const assess = (change, t=tol, digest=sha) => {
  const {actual,reference} = fixtures();
  change?.(actual,reference);
  return compareExperimentalSky(actual,reference,digest,t);
};

async function tempFiles(callback) {
  const dir=await mkdtemp(join(tmpdir(),'vs-reference-compare-'));
  const files={actual:join(dir,'actual.json'),reference:join(dir,'reference.json'),rawSource:join(dir,'raw.txt')};
  const {actual,reference}=fixtures();
  try {
    await Promise.all([
      writeFile(files.actual, JSON.stringify(actual)),
      writeFile(files.reference, JSON.stringify(reference)),
      writeFile(files.rawSource,raw),
    ]);
    await callback(files,dir);
  } finally { await rm(dir,{force:true,recursive:true}); }
}

test('matches equal synthetic geometric snapshots without any scientific validation claim',()=>{
  const out=assess();
  assert.equal(out.status,'WITHIN_DECLARED_TOLERANCE_EXPERIMENTAL');
  assert.equal(out.scientificallyValidated,false);
  assert.equal(out.bodyCount,10);
  assert.equal(out.maxDirectionArcsec,0);
  assert.equal(out.maxDistancePpm,0);
});
test('supports 360° wrap without a 359-degree false discrepancy',()=>{
  const out=assess((a,r)=>{ a.positions[0].longitudeDeg=359.999; r.positions[0].longitudeDeg=0.001; });
  assert.equal(out.status,'WITHIN_DECLARED_TOLERANCE_EXPERIMENTAL');
  assert.ok(out.maxDirectionArcsec>7 && out.maxDirectionArcsec<9);
  assert.ok(sphericalSeparationArcsec(359.999,0,0.001,0)>7);
});
test('checks equatorial, ecliptic and horizontal directions independently',()=>{
  for(const edit of [
    (a)=>a.positions[0].longitudeDeg+=1,
    (a)=>a.positions[1].rightAscensionDeg+=1,
    (a)=>a.positions[2].azimuthDeg+=1,
    (a)=>a.positions[3].altitudeDeg+=1,
  ]){
    const out=assess(a=>edit(a));
    assert.equal(out.status,'OUTSIDE_DECLARED_TOLERANCE');
    assert.ok(out.maxDirectionArcsec>100);
  }
});
test('distance discrepancy is in parts per million of the reference distance',()=>{
  const out=assess(a=>{ a.positions[0].distanceKm+=1000; });
  assert.equal(out.status,'OUTSIDE_DECLARED_TOLERANCE');
  assert.ok(out.maxDistancePpm>9 && out.maxDistancePpm<11);
});
test('epoch comparison checks both TT and TDB',()=>{
  for(const field of ['ttJulianDay','tdbJulianDay']){
    const out=assess((a,r)=>{a[field] += 0.0000005;});
    assert.equal(out.status,'OUTSIDE_DECLARED_TOLERANCE');
    assert.ok(out.maxEpochSeconds>0.03);
  }
});
test('strict equality of UTC, site, height, orientation and time-scale assumptions',()=>{
  for(const edit of [
    (_a,r)=>r.utcIso='2026-11-12T12:01:00.000Z',
    (_a,r)=>r.latMicro++,(_a,r)=>r.lngMicro--,(_a,r)=>r.heightMeters+=1,
    (_a,r)=>r.frame='ICRF',(_a,r)=>r.geometry='apparent',
    (_a,r)=>r.taiMinusUtcSeconds=36,
  ]){
    const out=assess(edit);
    assert.equal(out.status,'INCOMPARABLE');
  }
});
test('rejects missing, repeated, unknown or wrong-center celestial bodies',()=>{
  for(const edit of [
    (a)=>a.positions.pop(),
    (a)=>a.positions[4].bodyId='mars',
    (_a,r)=>r.positions[1]={...r.positions[0]},
    (_a,r)=>r.positions[4].centerKind='body_center',
    (_a,r)=>r.positions[0].distanceKm=-1,
  ]){
    const out=assess(edit);
    assert.equal(out.status,'INCOMPARABLE');
  }
});
test('near-zenith undefined azimuth requires consistent null on both sides',()=>{
  assert.equal(assess((a,r)=>{a.positions[0].azimuthDeg=null;r.positions[0].azimuthDeg=null;}).status,
    'WITHIN_DECLARED_TOLERANCE_EXPERIMENTAL');
  assert.equal(assess((a)=>{a.positions[0].azimuthDeg=null;}).status,'INCOMPARABLE');
});
test('rejects fake validation claims, unsupported model and injected private keys',()=>{
  for (const edit of [
    a=>{a.scientificStatus='validated';},
    a=>{a.provider='Swiss Ephemeris';},
    a=>{a.kernelSha256='private/path';},
    a=>{a.positions[0].secret='test';},
    a=>{a.positions[0].rightAscensionDeg=NaN;},
    a=>{a.positions[0].azimuthDeg=360;},
  ]) assert.equal(assess(edit).status,'INCOMPARABLE');
});
test('required approximation disclosures cannot be missing or substituted',()=>{
  for (const edit of [
    a=>a.approximations.pop(),
    (_a,r)=>r.approximations[0]='full_nutation',
    (_a,r)=>r.approximations[0]=r.approximations[1],
  ])assert.equal(assess(edit).status,'INCOMPARABLE');
});
test('mismatched saved raw-source digest is a hard stop',()=>{
  assert.deepEqual(assess(null,tol,'0'.repeat(64)),{status:'INCOMPARABLE',reason:'REFERENCE_PROVENANCE_UNVERIFIED'});
  assert.equal(assess((_a,r)=>{r.provenance.rawResponseSha256='e'.repeat(64);}).status,'INCOMPARABLE');
});
test('source metadata must declare independent source, query and conversion digest',()=>{
  for (const edit of [
    r=>r.provenance.source='VirgoStars-Ephemeris',
    r=>r.provenance.querySha256='missing',
    r=>r.provenance.normalizationCodeSha256='',
    r=>r.provenance.normalizationNotes='short',
    r=>r.provenance.secret='private',
  ]) assert.equal(assess((_a,r)=>edit(r)).status,'INCOMPARABLE');
});
test('tolerances are explicit, finite, bounded; never silently guessed',()=>{
  for (const broken of [null,{}, {maxDirectionArcsec:1,maxDistancePpm:1},
    {...tol,maxDirectionArcsec:0},{...tol,maxDirectionArcsec:3601},
    {...tol,maxDistancePpm:Infinity},{...tol,maxEpochSeconds:5},
  ]) assert.deepEqual(assess(null,broken),{status:'INCOMPARABLE',reason:'INVALID_TOLERANCE'});
});
test('exact canonical CLI arguments have to be explicitly supplied',()=>{
  const args=['--actual','a.json','--reference','r.json','--raw-source','raw.txt',
    '--max-direction-arcsec','1','--max-distance-ppm','20','--max-epoch-seconds','0.1'];
  assert.deepEqual(parseComparisonArgs(args),{
    actual:'a.json',reference:'r.json',rawSource:'raw.txt',
    tolerance:{maxDirectionArcsec:1,maxDistancePpm:20,maxEpochSeconds:0.1},
  });
  for(const bad of [[],args.slice(0,-2),[...args,'--more','bad'],
    [...args.slice(0,2),'--actual','duplicate',...args.slice(4)],
    args.map(x=>x==='0.1'?'1e-1':x),args.map(x=>x==='0.1'?'-0.1':x),
  ])assert.equal(parseComparisonArgs(bad),null);
});
test('offline integration verifies raw response bytes and JSON without output paths',async()=>tempFiles(async files=>{
  const report=await auditLocalReference(files,tol);
  assert.equal(report.status,'WITHIN_DECLARED_TOLERANCE_EXPERIMENTAL');
  assert.equal(JSON.stringify(report).includes(files.actual),false);
  assert.equal(JSON.stringify(report).includes('2026-11'),false);
  await writeFile(files.rawSource,'Changed source response');
  const changed=await auditLocalReference(files,tol);
  assert.equal(changed.status,'INCOMPARABLE');
}));
test('offline file gate rejects symlinks and directories',async()=>tempFiles(async(files,dir)=>{
  const link=join(dir,'link.json');
  await symlink(files.reference,link);
  await assert.rejects(auditLocalReference({...files,reference:link},tol),/unsafe or invalid/);
  const emptyDir=join(dir,'subdir');await mkdir(emptyDir);
  await assert.rejects(auditLocalReference({...files,reference:emptyDir},tol),/unsafe or invalid/);
}));
test('offline file gate fails on malformed or oversized JSON',async()=>tempFiles(async(files)=>{
  await writeFile(files.reference,'not json');
  await assert.rejects(auditLocalReference(files,tol),/unsafe or invalid/);
  await writeFile(files.reference,'a'.repeat(130 * 1024));
  await assert.rejects(auditLocalReference(files,tol),/unsafe or invalid/);
}));
test('CLI succeeds for synthetic in-tolerance files without leaking dates, paths or coordinates',async()=>tempFiles(async(files)=>{
  const script=new URL('../scripts/ephemeris/compare-de441-reference.mjs',import.meta.url);
  const args=['--actual',files.actual,'--reference',files.reference,'--raw-source',files.rawSource,
    '--max-direction-arcsec','1','--max-distance-ppm','1','--max-epoch-seconds','0.1'];
  const result=spawnSync(process.execPath,[script.pathname,...args],{encoding:'utf8'});
  assert.equal(result.status,0);
  assert.match(result.stdout,/WITHIN_DECLARED_TOLERANCE_EXPERIMENTAL/);
  assert.doesNotMatch(result.stdout + result.stderr,/2026-11-12|\/tmp|fictional|latMicro|longitudeDeg|private/);
}));
test('CLI mismatch exits nonzero and redacts raw inputs and absolute file paths',async()=>tempFiles(async(files)=>{
  const actual=JSON.parse(await (await import('node:fs/promises')).readFile(files.actual,'utf8'));
  actual.positions[0].longitudeDeg += 1;
  await writeFile(files.actual,JSON.stringify(actual));
  const script=new URL('../scripts/ephemeris/compare-de441-reference.mjs',import.meta.url);
  const args=['--actual',files.actual,'--reference',files.reference,'--raw-source',files.rawSource,
    '--max-direction-arcsec','1','--max-distance-ppm','1','--max-epoch-seconds','0.1'];
  const result=spawnSync(process.execPath,[script.pathname,...args],{encoding:'utf8'});
  assert.equal(result.status,1);
  assert.match(result.stdout,/OUTSIDE_DECLARED_TOLERANCE/);
  assert.doesNotMatch(result.stdout + result.stderr,/2026-11-12|\/tmp|fictional|latMicro|longitudeDeg|private/);
}));
