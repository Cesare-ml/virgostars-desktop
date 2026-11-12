import test from 'node:test';
import assert from 'node:assert/strict';
import {validReferenceCampaign, runReferenceCampaign} from '../scripts/ephemeris/de441-reference-campaign.mjs';

const dateA='2026-01-15T13:04:05.000Z';
const dateB='2026-07-15T13:04:05.000Z';
function makeCase(index,date,site) {
  return {
    id:'case-'+index,
    utcIso:date,
    latMicro:site===0?45_000_000:-34_000_000,
    lngMicro:site===0?12_000_000:151_000_000,
    heightMeters:site===0?120:10,
    actualFile:'sky-'+index+'.json',
    referenceFile:'ref-'+index+'.json',
  };
}
function crossed() {
  return {schemaVersion:1,cases:[
    makeCase(0,dateA,0),makeCase(1,dateA,1),
    makeCase(2,dateB,0),makeCase(3,dateB,1),
  ]};
}

test('two different dates and sites without crossed 2×2 coverage must be rejected',()=>{
  const incomplete={schemaVersion:1,cases:[
    makeCase(0,dateA,0),makeCase(1,'2026-01-16T13:04:05.000Z',0),
    makeCase(2,dateB,1),makeCase(3,'2026-07-16T13:04:05.000Z',1),
  ]};
  assert.equal(validReferenceCampaign(incomplete),false);
});

test('every site on only one date does not count as crossed coverage',()=>{
  const noCross={schemaVersion:1,cases:[
    makeCase(0,dateA,0),makeCase(1,dateA,1),
    makeCase(2,dateB,1),makeCase(3,'2026-07-16T13:04:05.000Z',0),
  ]};
  assert.equal(validReferenceCampaign(noCross),false);
});

test('two sites repeated across both dates satisfy the coverage matrix regardless of order',()=>{
  const m=crossed();
  assert.equal(validReferenceCampaign(m),true);
  m.cases.reverse();
  assert.equal(validReferenceCampaign(m),true);
});

test('duplicate filenames across two otherwise valid cases fail closed',()=>{
  for(const field of ['actualFile','referenceFile']) {
    const m=crossed();
    m.cases[2][field]=m.cases[0][field];
    assert.equal(validReferenceCampaign(m),false,field);
  }
  const m=crossed();
  m.cases[2].referenceFile=m.cases[0].actualFile;
  assert.equal(validReferenceCampaign(m),false,'cross-kind reuse');
});

test('invalid matrix must not read any file or invoke the numerical comparator',async()=>{
  const manifest={schemaVersion:1,cases:[
    makeCase(0,dateA,0),makeCase(1,dateA,1),
    makeCase(2,dateB,1),makeCase(3,'2026-07-16T13:04:05.000Z',0),
  ]};
  let reads=0;
  const result=await runReferenceCampaign(manifest,async()=>{reads++;throw Error('should not run');});
  assert.deepEqual(result,{kind:'invalid_campaign',checked:0,failed:0});
  assert.equal(reads,0);
});

test('a hostile getter in a returned file becomes one sanitized failed case',async()=>{
  const m=crossed();
  const fakeSnapshot=item=>({
    utcIso:item.utcIso,latMicro:item.latMicro,
    lngMicro:item.lngMicro,heightMeters:item.heightMeters,
  });
  const first=m.cases[0];
  const result=await runReferenceCampaign(m,async name=>{
    const item=m.cases.find(c=>c.actualFile===name || c.referenceFile===name);
    if(name===first.actualFile) return new Proxy({},{
      get(){throw Error('PRIVATE FILE PATH SHOULD NOT LEAK');},
    });
    return fakeSnapshot(item);
  });
  assert.equal(result.kind,'campaign_failed');
  assert.equal(result.checked,4);
  assert.ok(result.failed>=1);
  assert.equal(JSON.stringify(result).includes('PRIVATE FILE'),false);
});
