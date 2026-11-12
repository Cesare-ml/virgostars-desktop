import assert from 'node:assert/strict';
import test from 'node:test';
import { EXPERIMENTAL_BODIES, REQUIRED_APPROXIMATIONS, isExperimentalSkySnapshotV1, guardExperimentalSkyPort } from '../src/app/native/experimental-sky-contract.ts';

const request = Object.freeze({utcIso:'2026-11-12T17:01:02.000Z',latMicro:44_123_456,lngMicro:11_345_678});
function fixture() {
  return {
    schemaVersion:1, scientificStatus:'experimental_unverified',
    provider:'VirgoStars-Ephemeris',sourceFormat:'DE441_classic_binary',
    kernelSha256:'a'.repeat(64), utcIso:request.utcIso,
    latMicro:request.latMicro,lngMicro:request.lngMicro,heightMeters:120,
    observerDatum:'WGS84',frame:'mean_ecliptic_and_equatorial_of_date',
    geometry:'topocentric_geometric',ttJulianDay:2460997.209,tdbJulianDay:2460997.209,
    taiMinusUtcSeconds:37,approximations:[...REQUIRED_APPROXIMATIONS],
    positions:EXPERIMENTAL_BODIES.map((bodyId,i)=>({bodyId,
      centerKind:bodyId.endsWith('_barycenter')?'system_barycenter':'body_center',
      longitudeDeg:(i*31)%360,latitudeDeg:-12,rightAscensionDeg:(i*32)%360,
      declinationDeg:14,altitudeDeg:-23,azimuthDeg:140,distanceKm:1_000_000+i*1000})),
  };
}
function corrupt(modify){const s=fixture();modify(s);return s;}

test('complete, deliberately unverified geometric DE441 fixture passes shape checks',()=>{
  assert.equal(isExperimentalSkySnapshotV1(fixture(),request),true);
});
test('request instant and observer are bound to the inner snapshot, not just IPC envelope',()=>{
  for(const change of [s=>s.utcIso='2026-11-12T16:01:02.000Z',s=>s.latMicro++,s=>s.lngMicro--]){
    assert.equal(isExperimentalSkySnapshotV1(corrupt(change),request),false);
  }
});
test('only unverified geometric mean-of-date data can pass',()=>{
  for(const change of [
    s=>s.scientificStatus='validated',s=>s.sourceFormat='SPK',
    s=>s.geometry='apparent',s=>s.frame='true_ecliptic_of_date',
    s=>s.provider='Swiss Ephemeris',s=>s.observerDatum='unknown',
  ]) assert.equal(isExperimentalSkySnapshotV1(corrupt(change),request),false);
});
test('kernel provenance is a lower-case SHA256 digest, never a path',()=>{
  for(const change of [s=>s.kernelSha256='D:/external/de441.eph',
    s=>s.kernelSha256='z'.repeat(64),s=>s.kernelSha256='A'.repeat(64),
    s=>s.kernelSha256='b'.repeat(63)])
    assert.equal(isExperimentalSkySnapshotV1(corrupt(change),request),false);
});
test('reject missing, duplicated or unknown bodies instead of a partial invented chart',()=>{
  for(const change of [s=>s.positions.pop(),
    s=>s.positions[1]={...s.positions[0]},
    s=>s.positions[0].bodyId='earth',
    s=>s.positions[4].centerKind='body_center'])
    assert.equal(isExperimentalSkySnapshotV1(corrupt(change),request),false);
});
test('reject nonphysical angles, invalid distances and nonfinite numbers',()=>{
  for(const change of [s=>s.positions[0].longitudeDeg=360,
    s=>s.positions[0].longitudeDeg=-1,
    s=>s.positions[0].rightAscensionDeg=360,
    s=>s.positions[1].latitudeDeg=91,
    s=>s.positions[1].declinationDeg=Infinity,
    s=>s.positions[1].altitudeDeg=-91,
    s=>s.positions[1].azimuthDeg=360,
    s=>s.positions[1].distanceKm=0,
    s=>s.positions[1].distanceKm=NaN,
    s=>s.heightMeters=100001,
    s=>s.ttJulianDay=NaN,
    s=>s.tdbJulianDay=s.ttJulianDay+0.5])
    assert.equal(isExperimentalSkySnapshotV1(corrupt(change),request),false);
});
test('azimuth can be null only as an explicitly undefined angle',()=>{
  assert.equal(isExperimentalSkySnapshotV1(corrupt(s=>s.positions[0].azimuthDeg=null),request),true);
  assert.equal(isExperimentalSkySnapshotV1(corrupt(s=>s.positions[0].azimuthDeg=undefined),request),false);
});
test('reject missing or duplicated mandatory approximation disclosures',()=>{
  for(const change of [s=>s.approximations.pop(),
    s=>s.approximations[0]=s.approximations[1],
    s=>s.approximations[0]='fully_apparent',
  ])assert.equal(isExperimentalSkySnapshotV1(corrupt(change),request),false);
});
test('strict allowlists reject accidental internal filepaths, private metadata and extra fields',()=>{
  for(const change of [s=>s.secret='unexpected',
    s=>s.positions[0].filePath='D:/data/de441.eph',
    s=>delete s.positions[0].distanceKm,
    s=>delete s.sourceFormat])
    assert.equal(isExperimentalSkySnapshotV1(corrupt(change),request),false);
});
test('time range and TAI−UTC values are bounded and integer as in initial experimental model',()=>{
  for(const change of [s=>s.taiMinusUtcSeconds=37.5,
    s=>s.taiMinusUtcSeconds=99,s=>s.ttJulianDay=100,
    s=>s.schemaVersion=2])
    assert.equal(isExperimentalSkySnapshotV1(corrupt(change),request),false);
});
test('malformed IPC payloads fail closed without throwing',()=>{
  for(const value of [null,undefined,[],false,1,'',{}, {positions:new Array(10)}]){
    assert.equal(isExperimentalSkySnapshotV1(value,request),false);
  }
});
test('IERS C72 UTC coverage is enforced even for internally matching snapshots',()=>{
  for (const utcIso of ['1971-12-31T23:59:59.000Z', '2027-06-28T00:00:00.000Z']) {
    assert.equal(isExperimentalSkySnapshotV1({...fixture(),utcIso},{...request,utcIso}),false);
  }
});


test('native experimental port blocks malformed ready output without forwarding private data',async()=>{
  const req={...request,protocolVersion:1,sessionId:'s1',requestSeq:1,calculationKey:'example'};
  const invalid = guardExperimentalSkyPort(async () => ({status:'ready',snapshot:{...fixture(),filePath:'secret'}}));
  const response=await invalid(req,new AbortController().signal);
  assert.equal(response.status,'invalid_snapshot');
  assert.equal(JSON.stringify(response).includes('secret'),false);
  assert.equal('snapshot' in response,false);
});

test('native experimental port retains unavailable and properly shaped experimental-only results',async()=>{
  const req={...request,protocolVersion:1,sessionId:'s1',requestSeq:1,calculationKey:'example'};
  const unavailable={protocolVersion:1,status:'unavailable'};
  const portA=guardExperimentalSkyPort(async()=>unavailable);
  assert.equal(await portA(req,new AbortController().signal),unavailable);
  const ready={protocolVersion:1,status:'ready',snapshot:fixture()};
  const portB=guardExperimentalSkyPort(async()=>ready);
  assert.equal(await portB(req,new AbortController().signal),ready);
});
