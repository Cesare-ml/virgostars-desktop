import test from 'node:test';
import assert from 'node:assert/strict';
import {validVerifiedCampaign,runVerifiedCampaign} from '../scripts/ephemeris/verified-de441-campaign.mjs';

const A='2026-01-15T12:00:00.000Z', B='2026-07-15T12:00:00.000Z';
const good=()=>({status:'REVIEW_WITHIN_TOLERANCE_EXPERIMENTAL',
  maxDirectionArcsec:0.25,maxDistancePpm:3,maxEpochSeconds:0.005,scientificallyValidated:false});
const tolerances=()=>({maxDirectionArcsec:1,maxDistancePpm:10,maxEpochSeconds:0.1});
function one(i,utc,site) {
  return {id:'case'+i,utcIso:utc,latMicro:site===1?45000000:-34000000,
    lngMicro:site===1?12000000:151000000,heightMeters:site===1?120:10,
    actualFile:'actual-'+i+'.json',referenceFile:'reference-'+i+'.json',
    rawSourceFile:'raw-'+i+'.txt',rawQueryFile:'query-'+i+'.txt',normalizerFile:'normalize.py'};
}
function manifest() {
  return {schemaVersion:1,tolerances:tolerances(),cases:[
    one(0,A,1),one(1,A,2),one(2,B,1),one(3,B,2),
  ]};
}
function inputs(m=manifest()) {
  const files=new Map(m.cases.map(c=>[c.actualFile,{utcIso:c.utcIso,latMicro:c.latMicro,
    lngMicro:c.lngMicro,heightMeters:c.heightMeters,sha256:'a'.repeat(64)}]));
  return {readActual:async name=>structuredClone(files.get(name)),
    auditCase:async()=>good(),files};
}

test('2x2 crossed dates/sites is valid with one common normalizer source',()=>{
  const m=manifest();assert.equal(validVerifiedCampaign(m),true);
  m.cases.reverse();assert.equal(validVerifiedCampaign(m),true);
});
test('disjoint dates/sites cannot masquerade as a crossed astronomical campaign',()=>{
  const m=manifest();m.cases[2].utcIso='2026-07-16T12:00:00.000Z';
  assert.equal(validVerifiedCampaign(m),false);
  const n=manifest();n.cases[2].latMicro=55;
  assert.equal(validVerifiedCampaign(n),false);
});
test('one reused actual, reference or raw evidence file blocks before reads',()=>{
  for(const key of ['actualFile','referenceFile','rawSourceFile','rawQueryFile']){
    const m=manifest();m.cases[3][key]=m.cases[1][key];
    assert.equal(validVerifiedCampaign(m),false,key);
  }
  const m=manifest();m.cases[3].normalizerFile=m.cases[0].actualFile;
  assert.equal(validVerifiedCampaign(m),false);
});
test('case-insensitive basename aliases and IDs are rejected for Windows',()=>{
  const m=manifest();m.cases[3].actualFile=m.cases[0].referenceFile.toUpperCase();
  assert.equal(validVerifiedCampaign(m),false);
  const n=manifest();n.cases[3].id=n.cases[0].id.toUpperCase();
  assert.equal(validVerifiedCampaign(n),false);
});
test('Windows reserved filenames and path traversal are invalid',()=>{
  for(const filename of ['../private.json','C:/local.json','a\\b.json','CON.txt',
    'lpt9.json','file..json','.secrets.json','name.exe']){
    const m=manifest();m.cases[2].rawSourceFile=filename;
    assert.equal(validVerifiedCampaign(m),false,filename);
  }
});
test('Gregorian dates, IERS window, microdegrees and elevation are bounded',()=>{
  for(const utc of ['2026-02-30T12:00:00.000Z','2027-06-28T00:00:00.000Z',
    '1971-12-31T23:59:59.000Z','2026-01-15T12:00:00Z']){
    const m=manifest();m.cases[0].utcIso=utc;assert.equal(validVerifiedCampaign(m),false,utc);
  }
  for(const [key,value] of [['latMicro',90_000_001],['lngMicro',180_000_001],
    ['heightMeters',Infinity],['heightMeters',100001]]){
    const m=manifest();m.cases[0][key]=value;assert.equal(validVerifiedCampaign(m),false,key);
  }
});
test('tolerances cannot be absent, zero, nonfinite or over max bounds',()=>{
  for(const [key,value] of [['maxDirectionArcsec',0],['maxDirectionArcsec',3601],
    ['maxDistancePpm',Infinity],['maxEpochSeconds',1.1]]){
    const m=manifest();m.tolerances[key]=value;assert.equal(validVerifiedCampaign(m),false,key);
  }
});
test('unexpected fields, missing cases and excessive cases are invalid',()=>{
  const m=manifest();m.cases[0].birthRecord='private';assert.equal(validVerifiedCampaign(m),false);
  const n=manifest();n.secret='secret';assert.equal(validVerifiedCampaign(n),false);
  const x=manifest();x.cases=x.cases.slice(0,3);assert.equal(validVerifiedCampaign(x),false);
  const y=manifest();y.cases=Array(25).fill(y.cases[0]);assert.equal(validVerifiedCampaign(y),false);
});
test('valid fictional review returns only provisional counts, never scientific certification',async()=>{
  const m=manifest(), ops=inputs(m);
  const out=await runVerifiedCampaign(m,ops);
  assert.deepEqual(out,{status:'PROVISIONAL_ALL_WITHIN',checked:4,failed:0,
    blocked:0,outside:0,scientificallyValidated:false});
});
test('one case beyond numerical tolerance fails all, never a partial PASS',async()=>{
  const m=manifest(),ops=inputs(m);let i=0;
  ops.auditCase=async()=>++i===3?{...good(),status:'REVIEW_OUTSIDE_TOLERANCE_EXPERIMENTAL',maxDistancePpm:20}:good();
  assert.deepEqual(await runVerifiedCampaign(m,ops),{status:'CAMPAIGN_FAILED',
    checked:4,failed:1,blocked:0,outside:1,scientificallyValidated:false});
});
test('a forged numerical pass outside tolerance is classified as blocked',async()=>{
  const ops=inputs();ops.auditCase=async()=>({...good(),maxDirectionArcsec:50});
  const out=await runVerifiedCampaign(manifest(),ops);
  assert.equal(out.status,'CAMPAIGN_FAILED');assert.equal(out.blocked,4);
});
test('a forged outside result within tolerance is not trusted',async()=>{
  const ops=inputs();ops.auditCase=async()=>({...good(),status:'REVIEW_OUTSIDE_TOLERANCE_EXPERIMENTAL'});
  const out=await runVerifiedCampaign(manifest(),ops);
  assert.equal(out.outside,0);assert.equal(out.blocked,4);
});
test('evidence rejection and scientific validation claim always block',async()=>{
  const m=manifest(),ops=inputs(m);let i=0;
  ops.auditCase=async()=>++i===2?{status:'REVIEW_BLOCKED',reason:'EVIDENCE_CHANGED',scientificallyValidated:false}:
    ++i===4?{...good(),scientificallyValidated:true}:good();
  const out=await runVerifiedCampaign(m,ops);
  assert.equal(out.status,'CAMPAIGN_FAILED');assert.ok(out.blocked>0);
});
test('a changed snapshot digest before/after D-06 blocks a case',async()=>{
  const m=manifest(),ops=inputs(m);let i=0;
  ops.readActual=async name=>{const data=structuredClone(ops.files.get(name));
    if(name===m.cases[0].actualFile && ++i===2)data.sha256='b'.repeat(64);
    return data;};
  const out=await runVerifiedCampaign(m,ops);
  assert.equal(out.status,'CAMPAIGN_FAILED');assert.equal(out.blocked,1);
});
test('manifest UTC/site must correspond to actual snapshot, not just dates declared',async()=>{
  const m=manifest(),ops=inputs(m);ops.files.get(m.cases[2].actualFile).latMicro++;
  const out=await runVerifiedCampaign(m,ops);
  assert.equal(out.blocked,1);assert.equal(out.checked,4);
});
test('one thrown audit never leaks private error or skips subsequent sites',async()=>{
  const m=manifest(),ops=inputs(m);let checked=0;
  ops.auditCase=async()=>{checked++;if(checked===2)throw Error('PRIVATE PERSON/FILE');return good();};
  const out=await runVerifiedCampaign(m,ops);
  assert.equal(out.blocked,1);assert.equal(checked,4);
  assert.doesNotMatch(JSON.stringify(out),/PRIVATE|PERSON/);
});
test('manifest is validated before opening any input',async()=>{
  const m=manifest();m.cases[2].actualFile='../private.json';let calls=0;
  const out=await runVerifiedCampaign(m,{readActual:async()=>{calls++},auditCase:async()=>{calls++}});
  assert.equal(out.status,'INVALID_CAMPAIGN');assert.equal(calls,0);
  assert.equal((await runVerifiedCampaign(manifest(),null)).status,'INVALID_CAMPAIGN');
});
test('only one site is active at a time (no file-read fan-out)',async()=>{
  const ops=inputs();let inflight=0,max=0;
  ops.auditCase=async()=>{inflight++;max=Math.max(max,inflight);
    await Promise.resolve();inflight--;return good();};
  assert.equal((await runVerifiedCampaign(manifest(),ops)).status,'PROVISIONAL_ALL_WITHIN');
  assert.equal(max,1);
});
