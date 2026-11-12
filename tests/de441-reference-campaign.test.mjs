import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,mkdtempSync,rmSync,symlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {EXPERIMENTAL_BODIES,REQUIRED_APPROXIMATIONS} from '../src/app/native/experimental-sky-contract.ts';
import {runReferenceCampaign,validReferenceCampaign} from '../scripts/ephemeris/de441-reference-campaign.mjs';

const INPUT=[
  ['north-winter','2026-01-15T13:04:05.000Z',45000000,12000000,120],
  ['south-winter','2026-01-15T13:04:05.000Z',-34000000,151000000,10],
  ['north-summer','2026-07-15T23:04:05.000Z',45000000,12000000,120],
  ['south-summer','2026-07-15T23:04:05.000Z',-34000000,151000000,10],
];
const fileName=(id,kind)=>id+'-'+kind+'.json';
function manifest() {
  return {schemaVersion:1,cases:INPUT.map(([id,utcIso,latMicro,lngMicro,heightMeters])=>({
    id,utcIso,latMicro,lngMicro,heightMeters,
    actualFile:fileName(id,'sky'),referenceFile:fileName(id,'reference'),
  }))};
}
function actual(c){
  return {schemaVersion:1,scientificStatus:'experimental_unverified',provider:'VirgoStars-Ephemeris',
    sourceFormat:'DE441_classic_binary',kernelSha256:'a'.repeat(64),utcIso:c.utcIso,
    latMicro:c.latMicro,lngMicro:c.lngMicro,heightMeters:c.heightMeters,observerDatum:'WGS84',
    frame:'mean_ecliptic_and_equatorial_of_date',geometry:'topocentric_geometric',
    ttJulianDay:2460997.209,tdbJulianDay:2460997.209,taiMinusUtcSeconds:37,
    approximations:[...REQUIRED_APPROXIMATIONS],
    positions:EXPERIMENTAL_BODIES.map((bodyId,i)=>({bodyId,
      centerKind:bodyId.endsWith('_barycenter')?'system_barycenter':'body_center',
      longitudeDeg:(i*31)%360,latitudeDeg:-12,rightAscensionDeg:(i*32)%360,
      declinationDeg:14,altitudeDeg:-23,azimuthDeg:140,distanceKm:1000000+i*1000})),
  };
}
function reference(a){
  return {schemaVersion:1,sourceKind:'JPL_HORIZONS',sourceId:'HORIZONS_SYNTHETIC',
    sourceDocumentSha256:'b'.repeat(64),transformMethodId:'MOCK_GEOMETRIC_TRANSFORM',
    utcIso:a.utcIso,latMicro:a.latMicro,lngMicro:a.lngMicro,heightMeters:a.heightMeters,
    observerDatum:a.observerDatum,frame:a.frame,geometry:a.geometry,
    positions:a.positions.map(p=>({...p})),
  };
}
function store(man=manifest()) {
  const files=new Map();
  for(const c of man.cases){const a=actual(c);files.set(c.actualFile,a);files.set(c.referenceFile,reference(a));}
  return files;
}
const check=(m=manifest(),files=store(m))=>runReferenceCampaign(m,name=>files.get(name));
const cli=fileURLToPath(new URL('../scripts/ephemeris/verify-de441-campaign.mjs',import.meta.url));
function withDir(fn){
  const dir=mkdtempSync(join(tmpdir(),'vs-multi-de441-'));
  const man=manifest();const files=store(man);
  try {
    for(const [name,data] of files)writeFileSync(join(dir,name),JSON.stringify(data));
    const mp=join(dir,'campaign.json');writeFileSync(mp,JSON.stringify(man));
    return fn({dir,mp,man,files});
  }finally{rmSync(dir,{recursive:true,force:true});}
}
const run=path=>spawnSync(process.execPath,['--experimental-strip-types',cli,path],
  {encoding:'utf8',timeout:6000,maxBuffer:16384,env:{...process.env,NODE_NO_WARNINGS:'1'}});

test('four synthetic cases must span multiple dates and sites',()=>{
  assert.equal(validReferenceCampaign(manifest()),true);
  assert.equal(validReferenceCampaign({...manifest(),cases:manifest().cases.slice(0,3)}),false);
});
test('campaign requires unique case identifiers and unique time-site pairs',()=>{
  const m=manifest();m.cases[3].id=m.cases[0].id;assert.equal(validReferenceCampaign(m),false);
  const n=manifest();n.cases[3].utcIso=n.cases[1].utcIso;assert.equal(validReferenceCampaign(n),false);
});
test('manifest cannot fake diversity using repeated dates or repeated sites',()=>{
  const m=manifest();for(const c of m.cases)c.utcIso=m.cases[0].utcIso;
  assert.equal(validReferenceCampaign(m),false);
  const n=manifest();for(const c of n.cases){c.latMicro=12;c.lngMicro=0;c.heightMeters=0;}
  assert.equal(validReferenceCampaign(n),false);
});
test('only canonical valid UTC in the current IERS window and bounded WGS84 locations',()=>{
  for(const value of ['2026-02-30T00:00:00.000Z','2027-06-28T00:00:00.000Z','2026-11-12T12:00:00Z']){
    const m=manifest();m.cases[0].utcIso=value;assert.equal(validReferenceCampaign(m),false,value);
  }
  for(const [key,value] of [['latMicro',90_000_001],['lngMicro',-180_000_001],['heightMeters',Infinity]]){
    const m=manifest();m.cases[0][key]=value;assert.equal(validReferenceCampaign(m),false,key);
  }
});
test('file names are only relative basename JSON; no traversal, paths or same-file pairs',()=>{
  for(const name of ['../private.json','/etc/passwd','a\\b.json','..','file.txt','-weird.json']){
    const m=manifest();m.cases[0].actualFile=name;assert.equal(validReferenceCampaign(m),false,name);
  }
  const n=manifest();n.cases[0].actualFile=n.cases[0].referenceFile;
  assert.equal(validReferenceCampaign(n),false);
});
test('unexpected schema fields or more than 24 cases fail closed',()=>{
  assert.equal(validReferenceCampaign({...manifest(),secret:'must-not-leak'}),false);
  const m=manifest();m.cases[0].secrets=['x'];assert.equal(validReferenceCampaign(m),false);
  const n=manifest();n.cases=Array.from({length:25},(_,i)=>({...n.cases[i%4],id:'id'+i}));
  assert.equal(validReferenceCampaign(n),false);
});
test('complete synthetic matrix passes only as provisional, not scientifically validated',async()=>{
  const result=await check();assert.deepEqual(result,{kind:'all_within_provisional_tolerance',checked:4,failed:0});
});
test('one mismatched astronomical value fails the entire batch',async()=>{
  const files=store();files.get(manifest().cases[2].actualFile).positions[0].longitudeDeg+=3;
  assert.deepEqual(await check(manifest(),files),{kind:'campaign_failed',checked:4,failed:1});
});
test('manifest metadata must match the actual file; cannot fabricate time/place coverage',async()=>{
  const files=store();files.get(manifest().cases[1].actualFile).latMicro++;
  assert.deepEqual(await check(manifest(),files),{kind:'campaign_failed',checked:4,failed:1});
});
test('missing files or reader exceptions produce only failure counts',async()=>{
  const files=store();files.delete(manifest().cases[1].referenceFile);
  assert.deepEqual(await check(manifest(),files),{kind:'campaign_failed',checked:4,failed:1});
  const outcome=await runReferenceCampaign(manifest(),async name=>{
    if(name.includes('south-winter'))throw new Error('private path user data');
    return store().get(name);
  });
  assert.equal(outcome.kind,'campaign_failed');assert.equal(JSON.stringify(outcome).includes('private'),false);
});
test('invalid manifest never calls file reader',async()=>{
  let calls=0;
  const result=await runReferenceCampaign({bad:'data'},async()=>{calls++;return null;});
  assert.deepEqual(result,{kind:'invalid_campaign',checked:0,failed:0});assert.equal(calls,0);
});
test('CLI on four synthetic JSON cases returns only provisional aggregate status',()=>withDir(({mp,dir})=>{
  const p=run(mp);assert.equal(p.status,0,p.stderr);assert.match(p.stdout,/PROVISIONAL_ALL_WITHIN checked=4/);
  assert.match(p.stdout,/NOT certified/);assert.equal((p.stdout+p.stderr).includes(dir),false);
}));
test('CLI one bad case returns nonzero and no private details',()=>withDir(({mp,man,files,dir})=>{
  const name=man.cases[2].actualFile;const data=files.get(name);data.positions[0].distanceKm+=100;
  writeFileSync(join(dir,name),JSON.stringify(data));
  const p=run(mp);assert.equal(p.status,1);assert.match(p.stderr,/FAILED checked=4 failed=1/);
  assert.equal((p.stdout+p.stderr).includes(dir),false);
}));
test('CLI rejects symlink target and malformed Unicode as local invalid cases',()=>withDir(({mp,man,dir})=>{
  const name=man.cases[0].referenceFile;const destination=join(dir,name);
  const linked=join(dir,'shadow.json');
  writeFileSync(linked,'{}');
  rmSync(destination);try{symlinkSync(linked,destination,'file');}
  catch(e){if(!['EPERM','EACCES'].includes(e?.code))throw e;return;}
  const result=run(mp);assert.equal(result.status,1);assert.match(result.stderr,/FAILED checked=4 failed=1/);
  rmSync(destination);writeFileSync(destination,Buffer.from([0xff,0xfe,0x00]));
  const invalid=run(mp);assert.equal(invalid.status,1);assert.match(invalid.stderr,/FAILED checked=4 failed=1/);
}));
