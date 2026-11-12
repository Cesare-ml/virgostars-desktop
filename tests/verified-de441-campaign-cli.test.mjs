import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm,writeFile,symlink,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Integration fixtures are deliberately fictional. Their matching coordinates
// are not independent JPL data, and even an all-green run proves no astronomy.
const sha=x=>createHash('sha256').update(x).digest('hex');
const script=fileURLToPath(new URL('../scripts/ephemeris/run-verified-de441-campaign.mjs',import.meta.url));
const ids=['sun','moon','mercury','venus','mars_barycenter','jupiter_barycenter',
  'saturn_barycenter','uranus_barycenter','neptune_barycenter','pluto_barycenter'];
const limitations=['ut1_equals_utc','truncated_tdb_minus_tt','no_nutation',
  'no_light_time','no_aberration','no_gravitational_deflection',
  'no_polar_motion','no_atmospheric_refraction','outer_planet_system_barycenters'];
const note='FICTIONAL synthetic comparison only; not an authentic JPL/NAIF reduction';
function cases(){
  return [0,1,2,3].map(i=>({id:'case'+i,
    utcIso: i<2?'2026-01-15T12:00:00.000Z':'2026-07-15T12:00:00.000Z',
    latMicro:i%2===0?45000000:-34000000,
    lngMicro:i%2===0?12000000:151000000,
    heightMeters:i%2===0?120:10,
    actualFile:'actual-'+i+'.json',referenceFile:'reference-'+i+'.json',
    rawSourceFile:'raw-'+i+'.txt',rawQueryFile:'query-'+i+'.txt',normalizerFile:'normalize.py'}));
}
function sky(c){
  return {schemaVersion:1,utcIso:c.utcIso,latMicro:c.latMicro,lngMicro:c.lngMicro,
    heightMeters:c.heightMeters,observerDatum:'WGS84',
    frame:'mean_ecliptic_and_equatorial_of_date',geometry:'topocentric_geometric',
    ttJulianDay:2460997.0007,tdbJulianDay:2460997.0007,taiMinusUtcSeconds:37,
    approximations:limitations,
    positions:ids.map((bodyId,i)=>({bodyId,centerKind:bodyId.endsWith('_barycenter')?
      'system_barycenter':'body_center',longitudeDeg:i*32+1,latitudeDeg:2,
      rightAscensionDeg:i*33+1,declinationDeg:4,altitudeDeg:25,
      azimuthDeg:35,distanceKm:100000000+i*5000}))};
}
function run(path){return spawnSync(process.execPath,[script,path],{
  encoding:'utf8',timeout:25000,maxBuffer:65536,
});}
async function withCampaign(callback){
  const dir=await mkdtemp(join(tmpdir(),'vs-verified-campaign-'));
  const manifest={schemaVersion:1,tolerances:{maxDirectionArcsec:1,
    maxDistancePpm:10,maxEpochSeconds:0.1},cases:cases()};
  const manifestFile=join(dir,'campaign.json');
  const normalizer='# FICTIONAL source normalization for testing only\n';
  try {
    await writeFile(join(dir,'normalize.py'),normalizer);
    for(let i=0;i<manifest.cases.length;i++) {
      const c=manifest.cases[i],common=sky(c);
      const source='FICTIONAL Horizons response case '+i+'; not JPL data\n';
      const query='FICTIONAL query for case '+i+'\n';
      const actual={...structuredClone(common),scientificStatus:'experimental_unverified',
        provider:'VirgoStars-Ephemeris',sourceFormat:'DE441_classic_binary',kernelSha256:'a'.repeat(64)};
      const reference={...structuredClone(common),provenance:{source:'JPL_HORIZONS',
        rawResponseSha256:sha(source),querySha256:sha(query),
        normalizationCodeSha256:sha(normalizer),normalizationNotes:note}};
      await Promise.all([writeFile(join(dir,c.actualFile),JSON.stringify(actual)),
        writeFile(join(dir,c.referenceFile),JSON.stringify(reference)),
        writeFile(join(dir,c.rawSourceFile),source),
        writeFile(join(dir,c.rawQueryFile),query)]);
    }
    await writeFile(manifestFile,JSON.stringify(manifest));
    await callback({manifest,manifestFile,dir});
  }finally{await rm(dir,{recursive:true,force:true});}
}
function hides(output,dir){
  assert.equal(output.includes(dir),false);
  assert.doesNotMatch(output,/2026-01-15|2026-07-15|45000000|FICTIONAL Horizons/);
}

test('real CLI: four fictional cases return a provisional-only summary',async()=>withCampaign(async({manifestFile,dir})=>{
  const p=run(manifestFile);assert.equal(p.error,undefined);
  assert.equal(p.status,0,p.stderr);
  assert.match(p.stdout,/PROVISIONAL_ALL_WITHIN checked=4/);
  assert.match(p.stdout,/NOT independently certified/);
  hides(p.stdout+p.stderr,dir);
}));
test('real CLI: one changed fictional sky position fails the entire campaign',async()=>withCampaign(async({manifestFile,manifest,dir})=>{
  const path=join(dir,manifest.cases[2].actualFile);
  const data=JSON.parse(await readFile(path,'utf8'));
  data.positions[0].longitudeDeg+=1;
  await writeFile(path,JSON.stringify(data));
  const p=run(manifestFile);assert.equal(p.status,1,p.stderr);
  assert.match(p.stderr,/FAILED checked=4 blocked=0 outside=1/);
  hides(p.stdout+p.stderr,dir);
}));
test('real CLI: tampering a query blocks just its case and fails the campaign',async()=>withCampaign(async({manifestFile,manifest,dir})=>{
  await writeFile(join(dir,manifest.cases[1].rawQueryFile),'private changed query');
  const p=run(manifestFile);assert.equal(p.status,1,p.stderr);
  assert.match(p.stderr,/FAILED checked=4 blocked=1 outside=0/);
  hides(p.stdout+p.stderr,dir);
}));
test('real CLI: changed sky metadata cannot fake declared site coverage',async()=>withCampaign(async({manifest,manifestFile,dir})=>{
  const path=join(dir,manifest.cases[0].actualFile);
  const data=JSON.parse(await readFile(path,'utf8'));
  data.heightMeters=130;
  await writeFile(path,JSON.stringify(data));
  const p=run(manifestFile);assert.equal(p.status,1,p.stderr);
  assert.match(p.stderr,/FAILED checked=4 blocked=1 outside=0/);
  hides(p.stdout+p.stderr,dir);
}));
test('real CLI: invalid traversal rejects manifest before opening private files',async()=>withCampaign(async({manifest,manifestFile,dir})=>{
  manifest.cases[0].actualFile='../private.json';
  await writeFile(manifestFile,JSON.stringify(manifest));
  const p=run(manifestFile);assert.equal(p.status,2,p.stderr);
  assert.match(p.stderr,/INVALID_CAMPAIGN/);
  hides(p.stdout+p.stderr,dir);
}));
test('real CLI: symlinked sky file is blocked without following private target',async t=>withCampaign(async({manifest,manifestFile,dir})=>{
  const path=join(dir,manifest.cases[0].actualFile);
  const linked=join(dir,'private-target.json');
  await writeFile(linked,await readFile(path));
  await rm(path);
  try{await symlink(linked,path);}catch(e){
    if(['EPERM','EACCES'].includes(e?.code)){t.skip('no symlink privilege');return;}
    throw e;
  }
  const p=run(manifestFile);assert.equal(p.status,1,p.stderr);
  assert.match(p.stderr,/FAILED checked=4 blocked=1 outside=0/);
  hides(p.stdout+p.stderr,dir);
}));
test('real CLI: missing arguments and missing manifest fail with bounded status',async()=>{
  const none=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:5000});
  assert.equal(none.status,2);assert.match(none.stderr,/ARGUMENTS_REQUIRED/);
  const absent=run('/nonexistent-private-campaign.json');
  assert.equal(absent.status,2);assert.match(absent.stderr,/INVALID_LOCAL_FILE/);
  assert.doesNotMatch(absent.stderr,/nonexistent-private-campaign/);
});
