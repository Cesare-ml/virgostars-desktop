import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HORIZONS_BODIES,parseReviewedTdbJulianDay,buildHorizonsVectorPlan,
  parsePlanArgs,writePlanOnce } from '../scripts/ephemeris/prepare-horizons-vector-plan.mjs';

const stamp='2460000.500000';
const script=fileURLToPath(new URL('../scripts/ephemeris/prepare-horizons-vector-plan.mjs',import.meta.url));
async function temp(fn){const dir=await mkdtemp(join(tmpdir(),'vs-horizons-vector-'));
  try{await fn(dir)}finally{await rm(dir,{recursive:true,force:true})}}

test('exact ten geometric bodies, not planetary centers for outer barycenters',()=>{
  assert.equal(HORIZONS_BODIES.length,10);
  assert.deepEqual(HORIZONS_BODIES.map(x=>x.naifId),['10','301','199','299','4','5','6','7','8','9']);
  assert.equal(new Set(HORIZONS_BODIES.map(x=>x.bodyId)).size,10);
  assert.equal(HORIZONS_BODIES.find(x=>x.naifId==='5').centerKind,'system_barycenter');
});
test('one canonical explicit review-only plan, no coordinates or optimistic ready status',()=>{
  const p=buildHorizonsVectorPlan(stamp);
  assert.equal(p.reviewStatus,'query_plan_unverified');
  assert.equal(p.origin,'solar_system_barycenter');
  assert.equal(p.frame,'ICRF');
  assert.equal(p.timeInput,'independently_reviewed_julian_day');
  assert.equal(p.requests.length,10);
  assert.equal(JSON.stringify(p).includes('scientificallyValidated'),false);
});
test('all Horizons queries have explicitly correct inertial, geometric and TDB vector parameters',()=>{
  for(const q of buildHorizonsVectorPlan(stamp).requests){
    const url=new URL(q.url);
    assert.equal(url.origin,'https://ssd.jpl.nasa.gov');
    assert.equal(url.pathname,'/api/horizons.api');
    const p=url.searchParams;
    const required={format:'text',COMMAND:"'"+q.naifId+"'",OBJ_DATA:'NO',
      MAKE_EPHEM:'YES',EPHEM_TYPE:'VECTORS',CENTER:"'500@0'",REF_PLANE:'FRAME',
      REF_SYSTEM:'ICRF',OUT_UNITS:'KM-S',VEC_TABLE:'2',VEC_CORR:'NONE',
      CSV_FORMAT:'YES',VEC_LABELS:'NO',TIME_TYPE:'TDB',TLIST_TYPE:'JD',TLIST:"'"+stamp+"'"};
    assert.deepEqual(Object.fromEntries(p),required);
    assert.equal(p.has('START_TIME'),false);
    assert.equal(p.has('QUANTITIES'),false);
    assert.equal(p.has('SITE_COORD'),false);
    assert.ok(!q.url.includes('EMAIL_ADDR'));
  }
});
test('rejects ambiguous timestamps and malformed or out-of-window JD values',()=>{
  for(const jd of [null,0,'','2026-11-13','2460000','2460000.5','2.4600005e6',
      '2460000.500000Z','2460000.500000 ',' 2460000.500000',
      '2460000.500000\n','2460000.500000;DELETE', '2469999.5000',
      '2439999.5000','NaN','Infinity','2450000.0000000000']){
    assert.equal(parseReviewedTdbJulianDay(jd),null,String(jd));
    assert.throws(()=>buildHorizonsVectorPlan(jd),/INVALID_REVIEWED_TDB_JD/);
  }
});
test('TDB JD boundaries are explicit, not inferred from local civil time',()=>{
  assert.ok(parseReviewedTdbJulianDay('2441317.5000'));
  assert.ok(parseReviewedTdbJulianDay('2461585.4999'));
  assert.equal(parseReviewedTdbJulianDay('2441317.4999'),null);
  assert.equal(parseReviewedTdbJulianDay('2461585.5000'),null);
});
test('strict CLI switch parsing prevents duplicates and unknown arguments',()=>{
  assert.deepEqual(parsePlanArgs(['--out','manual.json','--tdb-jd',stamp]),
    {tdbJulianDay:stamp,outputPath:'manual.json'});
  for(const bad of [[],['--out','a'],['--tdb-jd',stamp,'--tdb-jd',stamp],
    ['--tdb-jd',stamp,'--unknown','x'],['--tdb-jd',stamp,'--out',''],
    ['--tdb-jd',stamp,'--out','--foo'],['--tdb-jd',stamp,'--out','a\nsecret']]){
    assert.equal(parsePlanArgs(bad),null);
  }
});
test('manual output creates plan as a new local file once and refuses overwrites',async()=>temp(async dir=>{
  const path=join(dir,'requests.json');const plan=buildHorizonsVectorPlan(stamp);
  await writePlanOnce(path,plan);
  assert.deepEqual(JSON.parse(await readFile(path,'utf8')),plan);
  await assert.rejects(writePlanOnce(path,plan),{code:'EEXIST'});
  assert.deepEqual(JSON.parse(await readFile(path,'utf8')),plan);
}));
test('does not overwrite an existing file with sensitive data',async()=>temp(async dir=>{
  const path=join(dir,'private-record.json');
  await writeFile(path,'PRIVATE_DATA');
  await assert.rejects(writePlanOnce(path,buildHorizonsVectorPlan(stamp)),{code:'EEXIST'});
  assert.equal(await readFile(path,'utf8'),'PRIVATE_DATA');
}));
test('real CLI only prints sanitized status; never leaks epoch or output path',async()=>temp(async dir=>{
  const path=join(dir,'generated.json');
  const args=['--tdb-jd',stamp,'--out',path];
  const ok=spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
  assert.equal(ok.status,0,ok.stderr);
  assert.match(ok.stdout,/CREATED_UNVERIFIED_10_BODY_REQUESTS/);
  assert.ok(!ok.stdout.includes(stamp));assert.ok(!ok.stdout.includes(path));
  const duplicate=spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
  assert.equal(duplicate.status,1);
  assert.match(duplicate.stderr,/WRITE_FAILED/);
  assert.ok(!(duplicate.stdout+duplicate.stderr).includes(path));
}));
test('rejects invalid CLI without touching filesystem',async()=>temp(async dir=>{
  const path=join(dir,'should-not-exist');
  const x=spawnSync(process.execPath,[script,'--tdb-jd','2026-12-01','--out',path],{encoding:'utf8'});
  assert.equal(x.status,1);assert.match(x.stderr,/INVALID_ARGUMENTS/);
  await assert.rejects(readFile(path),{code:'ENOENT'});
}));
