import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildHorizonsVectorPlan } from '../scripts/ephemeris/prepare-horizons-vector-plan.mjs';
import { parseHorizonsVectorResponse, validateCanonicalPlan, acquireHorizonsVectors,
  parseAcquisitionArgs } from '../scripts/ephemeris/acquire-horizons-vectors.mjs';

const jd='2460000.500000';
const plan=()=>buildHorizonsVectorPlan(jd);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const dec=(obj)=>Object.fromEntries(obj.searchParams);
function responseText(target,options={}) {
  const row=options.row??(
    '2460000.500000000, A.D. 2023-Feb-25 00:00:00.0000, '+
    ' 1.200000000000E+07, -2.300000000000E+06, 3.200000000000E+05, '+
    ' 1.230000000000E+01, -4.560000000000E+00, 0.000000000000E+00,');
  return [
    'API VERSION: 1.0',
    'API SOURCE: NASA/JPL Horizons API',
    '',
    'Ephemeris / WWW_USER / synthetic test (not NASA/JPL)',
    'Target body name: Fictional target ('+(options.target??target.naifId)+') {source: DE441}',
    'Center body name: '+(options.center??'Solar System Barycenter (0) {source: DE441}'),
    'Center-site name: BODY CENTER',
    'Start time : A.D. 2023-Feb-25 00:00:00.0000 TDB',
    'Output units : KM-S',
    'Output type : '+(options.type??'GEOMETRIC cartesian states'),
    'Output format : 2 (position and velocity)',
    'Reference frame : '+(options.frame??'ICRF/J2000.0'),
    'Coordinate systm: '+(options.coords??'Earth Mean Equator and Equinox of Reference Epoch'),
    'JDTDB, Calendar Date (TDB), X, Y, Z, VX, VY, VZ',
    '$$SOE',row,...(options.second?[row]:[]),'$$EOE',
    'Fictional fixture only: independent JPL authenticity is NOT demonstrated.',
    '',
  ].join('\n');
}
async function fixture(run) {
  const dir=await mkdtemp(join(tmpdir(),'vs-horizons-acquire-'));
  const planPath=join(dir,'plan.json'), output=join(dir,'retrieved');
  try {await writeFile(planPath,JSON.stringify(plan()));await run({planPath,output,dir});}
  finally{await rm(dir,{recursive:true,force:true});}
}
const mock=(options={}, onRequest=()=>{})=>async(url,opts)=>{
  const bodyId=plan().requests.find(x=>x.url===url);
  assert.ok(bodyId,'only canonical URL may be fetched');
  assert.equal(opts.redirect,'error');assert.equal(opts.method,'GET');
  assert.equal(opts.credentials,'omit');assert.equal(opts.cache,'no-store');
  onRequest(bodyId,opts);
  const text=responseText(bodyId,options[bodyId.bodyId]??options.default??{});
  return new Response(text,{status:200,headers:{'content-type':'text/plain'}});
};
const options={pauseMs:0,pauseFn:async()=>{}};

test('offline plan has exactly ten immutable canonical HTTPS requests',()=>{
  assert.deepEqual(validateCanonicalPlan(plan()),plan());
  for(const q of plan().requests){
    const url=new URL(q.url);
    assert.equal(url.origin,'https://ssd.jpl.nasa.gov');
    assert.equal(url.searchParams.get('EPHEM_TYPE'),'VECTORS');
    assert.equal(url.searchParams.get('VEC_CORR'),'NONE');
    assert.equal(url.searchParams.get('REF_PLANE'),'FRAME');
    assert.equal(url.searchParams.get('TLIST'),"'"+jd+"'");
  }
});
test('rejects altered plan URL/target, unknown keys, and forged ready flags',()=>{
  for(const edit of [p=>p.requests[0].url='https://evil.example/path',
    p=>p.requests[0].naifId='399', p=>p.requests.pop(),p=>p.extra='hidden',
    p=>p.reviewStatus='verified']){
    const v=plan();edit(v);assert.equal(validateCanonicalPlan(v),null);
  }
});
test('single-row parser retains raw vector components as review-only',()=>{
  const req=plan().requests[0];const x=parseHorizonsVectorResponse(responseText(req),{...req,tdbJulianDay:jd});
  assert.equal(x.status,'PARSED_VECTOR_UNAUTHENTICATED');
  assert.deepEqual(x.positionKm,[12000000,-2300000,320000]);
  assert.deepEqual(x.velocityKmPerSecond,[12.3,-4.56,0]);
  assert.equal(x.sourceClaim,'DE441');assert.equal(x.scientificallyValidated,false);
});
test('different body target ID fails',()=>{
  const req=plan().requests[0];
  assert.throws(()=>parseHorizonsVectorResponse(responseText(req,{target:'301'}),{...req,tdbJulianDay:jd}),/TARGET_MISMATCH/);
});
test('wrong barycenter, frame, plane or nongeometric corrections fail',()=>{
  const req={...plan().requests[0],tdbJulianDay:jd};
  for(const changes of [ {center:'Earth (399)'}, {frame:'Ecliptic of J2000.0'},
    {coords:'Ecliptic and Mean Equinox of Reference Epoch'},
    {type:'ASTROMETRIC cartesian states'}]){
    assert.throws(()=>parseHorizonsVectorResponse(responseText(req,changes),req),/CENTER_MISMATCH|MODEL_MISMATCH/);
  }
});
test('duplicate/missing vector markers and multiple epochs fail',()=>{
  const req={...plan().requests[0],tdbJulianDay:jd};
  const good=responseText(req);
  for(const text of [good.replace('$$SOE','NO_MARKER'),good.replace('$$EOE','NO_MARKER'),
    good.replace('$$EOE','$$SOE\n$$EOE'),responseText(req,{second:true})]){
    assert.throws(()=>parseHorizonsVectorResponse(text,req),/INVALID_VECTOR_TABLE/);
  }
});
test('rejects time mismatch, NaN and truncated vectors',()=>{
  const req={...plan().requests[0],tdbJulianDay:jd};
  for(const row of ['2460001.500000000, A.D. 2023-Feb-25 00:00:00.0000, 1,2,3,4,5,6,',
    '2460000.500000000, A.D. 2023-Feb-25 00:00:00.0000, NaN,2,3,4,5,6,',
    '2460000.500000000, A.D. 2023-Feb-25 00:00:00.0000, 1,2,3,4,5,']){
    assert.throws(()=>parseHorizonsVectorResponse(responseText(req,{row}),req),/EPOCH_MISMATCH|INVALID_VECTOR_TABLE/);
  }
});
test('mocked HTTP acquisition persists exactly 10 untouched original files plus manifest',async()=>fixture(async({planPath,output})=>{
  let calls=0,pauses=0;
  const result=await acquireHorizonsVectors(planPath,output,{fetchFn:mock({},()=>calls++),pauseFn:async()=>{pauses++},pauseMs:1});
  assert.deepEqual(result,{status:'CAPTURED_10_UNAUTHENTICATED_RESPONSES',count:10,scientificallyValidated:false});
  assert.equal(calls,10);assert.equal(pauses,9);
  const manifest=JSON.parse(await readFile(join(output,'response-manifest.json'),'utf8'));
  assert.equal(manifest.status,'STRUCTURE_CHECKED_NOT_AUTHENTICATED');
  assert.equal(manifest.responses.length,10);
  assert.equal(manifest.tdbJulianDay,jd);
  for(const req of plan().requests){
    const bytes=await readFile(join(output,req.responseFilename));
    const item=manifest.responses.find(x=>x.bodyId===req.bodyId);
    assert.equal(sha(bytes),item.originalResponseSha256);
    assert.equal(sha(Buffer.from(req.url)),item.queryUrlSha256);
    assert.equal(item.sourceClaim,'DE441');
    assert.ok(bytes.toString().includes('synthetic test'));
    assert.ok(!Object.hasOwn(item,'positionKm'));
  }
}));
test('no destructive overwrite: preexisting output directory blocks before fetch',async()=>fixture(async({planPath,output})=>{
  await mkdirOutput(output);
  await writeFile(join(output,'valuable.txt'),'KEEP ME');
  let calls=0;
  await assert.rejects(acquireHorizonsVectors(planPath,output,{...options,fetchFn:async()=>{calls++}}),{code:'EEXIST'});
  assert.equal(calls,0);assert.equal(await readFile(join(output,'valuable.txt'),'utf8'),'KEEP ME');
}));
async function mkdirOutput(path){const {mkdir}=await import('node:fs/promises');await mkdir(path);}
test('failed fourth response rolls back only newly-created directory',async()=>fixture(async({planPath,output})=>{
  let count=0;
  const fetchFn=async(...args)=>{count++;if(count===4)throw Error('network detail with sensitive path');return mock()(...args);};
  await assert.rejects(acquireHorizonsVectors(planPath,output,{...options,fetchFn}));
  assert.equal(count,4);
  await assert.rejects(stat(output),{code:'ENOENT'});
}));
test('rejects HTTP 302/500 and no raw records persist',async()=>fixture(async({planPath,output})=>{
  for(const status of [302,500]){
    await assert.rejects(acquireHorizonsVectors(planPath,output,{...options,fetchFn:async()=>new Response('bad',{status})}),/FETCH_FAILED/);
    await assert.rejects(stat(output),{code:'ENOENT'});
  }
}));
test('rejects an oversized streamed response and removes the new directory',async()=>fixture(async({planPath,output})=>{
  await assert.rejects(acquireHorizonsVectors(planPath,output,{...options,fetchFn:async()=>new Response('x'.repeat(512*1024+1))}),/RESPONSE_TOO_LARGE/);
  await assert.rejects(stat(output),{code:'ENOENT'});
}));
test('rejects incorrect body or forged error document with HTTP 200',async()=>fixture(async({planPath,output})=>{
  const wrong=mock({sun:{target:'301'}});
  await assert.rejects(acquireHorizonsVectors(planPath,output,{...options,fetchFn:wrong}),/TARGET_MISMATCH/);
  await assert.rejects(stat(output),{code:'ENOENT'});
  await assert.rejects(acquireHorizonsVectors(planPath,output,{...options,fetchFn:async()=>new Response('Horizons error: too many requests')}),/UNSUPPORTED_API_FORMAT/);
  await assert.rejects(stat(output),{code:'ENOENT'});
}));
test('symlinked or tampered plan is not accepted and cannot trigger network',async()=>fixture(async({planPath,output,dir})=>{
  const link=join(dir,'plan-link.json');await symlink(planPath,link);
  let called=0;const fetchFn=async()=>{called++;throw Error('unexpected');};
  await assert.rejects(acquireHorizonsVectors(link,output,{...options,fetchFn}),/INVALID_PLAN/);
  const tampered=plan();tampered.requests[1].url='https://evil.example/';
  await writeFile(planPath,JSON.stringify(tampered));
  await assert.rejects(acquireHorizonsVectors(planPath,output,{...options,fetchFn}),/INVALID_PLAN/);
  assert.equal(called,0);
}));
test('strict manual CLI arguments and failure status do not leak user-supplied paths',async()=>fixture(async({planPath,dir})=>{
  assert.deepEqual(parseAcquisitionArgs(['--output-dir','new','--plan','plan.json']),{planPath:'plan.json',outputDirectory:'new'});
  for(const v of [[],['--plan','x'],['--plan','x','--plan','y'],['--plan','x','--bad','y']]){
    assert.equal(parseAcquisitionArgs(v),null);
  }
  const script=fileURLToPath(new URL('../scripts/ephemeris/acquire-horizons-vectors.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[script,'--bad',planPath,'--output-dir',join(dir,'out')],{encoding:'utf8'});
  assert.equal(result.status,1);
  assert.match(result.stderr,/HORIZONS_ACQUIRE:INVALID_ARGUMENTS/);
  assert.ok(!(result.stderr+result.stdout).includes(dir));
}));

test('wire-format API header is required and version-pinned, despite valid vector row',()=>{
  const req={...plan().requests[0],tdbJulianDay:jd};
  const good=responseText(req);
  for(const broken of [good.replace('API VERSION: 1.0','API VERSION: 2.0'),
    good.replace('API SOURCE: NASA/JPL Horizons API','API SOURCE: Unrelated service'),
    good.replace('API VERSION: 1.0\n',''),good.replace('API SOURCE: NASA/JPL Horizons API\n',''),
    '  '+good]) {
    assert.throws(()=>parseHorizonsVectorResponse(broken,req),/UNSUPPORTED_API_FORMAT/);
  }
});
