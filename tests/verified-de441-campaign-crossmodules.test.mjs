/**
 * Real D-04 numeric comparator + D-06 verified audit + D-09 campaign.
 * No network/filesystem readers: source evidence and snapshot hashes are
 * deliberately simulated, but every numerical/coordination function is REAL.
 * Tests are not astronomical science or JPL authentication.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {compareExperimentalSky} from '../scripts/ephemeris/compare-de441-reference.mjs';
import {runVerifiedDe441Audit} from '../scripts/ephemeris/run-verified-de441-audit.mjs';
import {runVerifiedCampaign} from '../scripts/ephemeris/verified-de441-campaign.mjs';

const IDS=[
  'sun','moon','mercury','venus','mars_barycenter','jupiter_barycenter',
  'saturn_barycenter','uranus_barycenter','neptune_barycenter','pluto_barycenter',
];
const LIMITATIONS=[
  'ut1_equals_utc','truncated_tdb_minus_tt','no_nutation','no_light_time',
  'no_aberration','no_gravitational_deflection','no_polar_motion',
  'no_atmospheric_refraction','outer_planet_system_barycenters',
];
const RAW_SHA='b'.repeat(64),REFERENCE_SHA='f'.repeat(64),SKY_SHA='e'.repeat(64);
const tol=Object.freeze({maxDirectionArcsec:1,maxDistancePpm:10,maxEpochSeconds:0.1});

const cases=()=>[0,1,2,3].map(i=>({
  id:'case'+i,utcIso:i<2?'2026-01-15T12:00:00.000Z':'2026-07-15T12:00:00.000Z',
  latMicro:i%2===0?45000000:-34000000,lngMicro:i%2===0?12000000:151000000,
  heightMeters:i%2===0?120:10,
  actualFile:'actual-'+i+'.json',referenceFile:'reference-'+i+'.json',
  rawSourceFile:'raw-'+i+'.txt',rawQueryFile:'query-'+i+'.txt',normalizerFile:'normalizer.py',
}));
function sky(c) {
  return {
    schemaVersion:1,utcIso:c.utcIso,latMicro:c.latMicro,lngMicro:c.lngMicro,
    heightMeters:c.heightMeters,observerDatum:'WGS84',
    frame:'mean_ecliptic_and_equatorial_of_date',geometry:'topocentric_geometric',
    ttJulianDay:2460997.0007,tdbJulianDay:2460997.0007,taiMinusUtcSeconds:37,
    approximations:[...LIMITATIONS],
    positions:IDS.map((bodyId,i)=>({
      bodyId,centerKind:bodyId.endsWith('_barycenter')?'system_barycenter':'body_center',
      longitudeDeg:i*32+1,latitudeDeg:2,rightAscensionDeg:i*33+1,
      declinationDeg:4,altitudeDeg:25,azimuthDeg:35,
      distanceKm:100000000+i*5000,
    })),
  };
}
function fixture(){
  const items=cases();
  const snapshots=items.map(item=>{
    const v=sky(item);
    return {
      actual:{...structuredClone(v),scientificStatus:'experimental_unverified',
        provider:'VirgoStars-Ephemeris',sourceFormat:'DE441_classic_binary',
        kernelSha256:'a'.repeat(64)},
      reference:{...structuredClone(v),provenance:{
        source:'JPL_HORIZONS',rawResponseSha256:RAW_SHA,
        querySha256:'c'.repeat(64),normalizationCodeSha256:'d'.repeat(64),
        normalizationNotes:'Fictional comparison source for test only; not JPL astronomy',
      }},
    };
  });
  return {manifest:{schemaVersion:1,tolerances:{...tol},cases:items},snapshots};
}
async function run(f, overrides={}){
  const {manifest,snapshots}=f;
  const calls=[];
  const result=await runVerifiedCampaign(manifest,{
    readActual:async name=>{
      const i=Number(name.match(/\d+/)?.[0]);
      const a=snapshots[i].actual;
      return {utcIso:a.utcIso,latMicro:a.latMicro,lngMicro:a.lngMicro,
        heightMeters:a.heightMeters,sha256:SKY_SHA};
    },
    auditCase:async (item,tolerance)=>{
      const i=Number(item.id.slice(4)),pair=snapshots[i];
      calls.push(item.id);
      let fingerprints=0;
      return runVerifiedDe441Audit({
        evidence:{reference:item.referenceFile},
        comparison:{actual:item.actualFile,tolerance},
      },{
        verify:async()=>overrides.evidence?.(i)??({
          status:'EVIDENCE_BYTES_MATCH',referenceSha256:REFERENCE_SHA}),
        fingerprint:async()=>{
          const n=++fingerprints;
          return {status:'SNAPSHOT_FINGERPRINTED',
            sha256:overrides.fingerprint?.(i,n)??SKY_SHA};
        },
        compare:async()=>overrides.compare?.(i,pair,tolerance) ??
          compareExperimentalSky(pair.actual,pair.reference,RAW_SHA,tolerance),
      });
    },
  });
  return {result,calls};
}
test('actual three-module functions accept four matching synthetic snapshots provisionally',async()=>{
  const {result,calls}=await run(fixture());
  assert.deepEqual(result,{status:'PROVISIONAL_ALL_WITHIN',checked:4,
    failed:0,blocked:0,outside:0,scientificallyValidated:false});
  assert.deepEqual(calls,['case0','case1','case2','case3']);
});
test('one changed ecliptic direction fails the whole campaign as OUTSIDE',async()=>{
  const f=fixture();f.snapshots[2].actual.positions[0].longitudeDeg+=1;
  const {result}=await run(f);
  assert.deepEqual(result,{status:'CAMPAIGN_FAILED',checked:4,failed:1,
    blocked:0,outside:1,scientificallyValidated:false});
});
test('one incompatible reference location becomes COMPARISON_INVALID and is blocked',async()=>{
  const f=fixture();f.snapshots[1].reference.lngMicro++;
  const {result}=await run(f);
  assert.equal(result.status,'CAMPAIGN_FAILED');
  assert.equal(result.blocked,1);assert.equal(result.outside,0);
});
test('one forged validated result is blocked by the actual D-06 coordinator',async()=>{
  const f=fixture();
  const {result}=await run(f,{compare:i=>i===1?
    {status:'WITHIN_DECLARED_TOLERANCE_EXPERIMENTAL',bodyCount:10,
      maxDirectionArcsec:0,maxDistancePpm:0,maxEpochSeconds:0,
      scientificallyValidated:true}:undefined});
  assert.equal(result.blocked,1);
  assert.equal(result.status,'CAMPAIGN_FAILED');
});
test('evidence mismatch blocks only its case, without short-circuiting all other cases',async()=>{
  const {result,calls}=await run(fixture(),{
    evidence:i=>i===0?{status:'EVIDENCE_REJECTED'}:undefined,
  });
  assert.equal(result.blocked,1);assert.equal(result.checked,4);
  assert.deepEqual(calls,['case0','case1','case2','case3']);
});
test('changed experimental snapshot digest within D-06 blocks the campaign',async()=>{
  const {result}=await run(fixture(),{fingerprint:(i,n)=>i===3&&n===2?'9'.repeat(64):undefined});
  assert.equal(result.blocked,1);assert.equal(result.outside,0);
});
test('all cross-module outcomes remain marked scientifically unverified',async()=>{
  for(const f of [fixture(),fixture()]){
    f.snapshots[1].reference.positions[0].distanceKm+=2000;
    const {result}=await run(f);
    assert.equal(result.scientificallyValidated,false);
    assert.equal(result.status,'CAMPAIGN_FAILED');
  }
});
