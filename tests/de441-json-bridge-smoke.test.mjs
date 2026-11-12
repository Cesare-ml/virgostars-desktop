import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPERIMENTAL_BODIES, REQUIRED_APPROXIMATIONS } from '../src/app/native/experimental-sky-contract.ts';

// This test intercepts the Cargo command. It NEVER calculates astronomy or reads
// a real DE441 file; it tests only the actual wrapper + shared IPC validator.
const script = fileURLToPath(new URL('../scripts/verify-de441-json-bridge.mjs', import.meta.url));
const date = '2026-11-12T17:01:02.000Z';
const sensitivePath = 'private path ; never echo this';
const validArgs = [sensitivePath, date, '44123456', '11345678', '120'];
const mockedCargoSupported = process.platform !== 'win32';

function fixture() {
  return {
    schemaVersion:1, scientificStatus:'experimental_unverified',
    provider:'VirgoStars-Ephemeris', sourceFormat:'DE441_classic_binary',
    kernelSha256:'a'.repeat(64), utcIso:date,
    latMicro:44123456,lngMicro:11345678,heightMeters:120,
    observerDatum:'WGS84',frame:'mean_ecliptic_and_equatorial_of_date',
    geometry:'topocentric_geometric',ttJulianDay:2460997.209,
    tdbJulianDay:2460997.209,taiMinusUtcSeconds:37,
    approximations:[...REQUIRED_APPROXIMATIONS],
    positions:EXPERIMENTAL_BODIES.map((bodyId,i)=>({
      bodyId,centerKind:bodyId.endsWith('_barycenter')?'system_barycenter':'body_center',
      longitudeDeg:(i*31)%360,latitudeDeg:-12,rightAscensionDeg:(i*32)%360,
      declinationDeg:14,altitudeDeg:-23,azimuthDeg:140,distanceKm:1000000+i*1000,
    })),
  };
}

function run(args, opts={}) {
  let dir;
  try {
    const env = {...process.env,NODE_NO_WARNINGS:'1'};
    if(opts.mock) {
      dir=mkdtempSync(join(tmpdir(),'vs-de441-smoke-'));
      const mock = join(dir, 'cargo');
      writeFileSync(mock, [
        '#!/usr/bin/env node',
        "import('node:fs').then(fs => {",
        "  if (process.env.MOCK_ARG_FILE) fs.writeFileSync(process.env.MOCK_ARG_FILE, JSON.stringify(process.argv.slice(2)));",
        "  if (process.env.MOCK_MODE === 'oversized') process.stdout.write('X'.repeat(180000));",
        "  else if (process.env.MOCK_MODE === 'nonzero') { process.stderr.write('SECRET PRIVATE PATH SHOULD NOT LEAK'); process.exitCode=17; }",
        "  else process.stdout.write(process.env.MOCK_PAYLOAD || '{}');",
        '});',
        '',
      ].join('\n'));
      chmodSync(mock,0o755);
      env.PATH=dir+delimiter+(process.env.PATH??'');
      env.MOCK_MODE=opts.mode??'valid';
      env.MOCK_PAYLOAD=typeof opts.payload==='string'?opts.payload:JSON.stringify(opts.payload??fixture());
      env.MOCK_ARG_FILE=join(dir,'arguments.json');
    } else if(opts.noCargo) {
      // Deliberately disallow cargo lookup, including when a host developer has it.
      dir=mkdtempSync(join(tmpdir(),'vs-de441-no-cargo-'));
      env.PATH=dir;
    }
    const result=spawnSync(process.execPath,['--experimental-strip-types',script,...args],{
      env,encoding:'utf8',timeout:12000,maxBuffer:200000,
    });
    const recorded = opts.mock ? JSON.parse(readFileSync(env.MOCK_ARG_FILE,'utf8')) : null;
    return {...result,recorded};
  } finally {
    if(dir) rmSync(dir,{recursive:true,force:true});
  }
}
function expectError(result,code) {
  assert.equal(result.status,1, JSON.stringify({stderr:result.stderr,stdout:result.stdout}));
  assert.match(result.stderr,new RegExp('DE441_SMOKE:'+code+'\\n'));
  assert.equal(result.stdout,'');
  assert.equal((result.stdout+result.stderr).includes(sensitivePath),false);
  assert.equal((result.stdout+result.stderr).includes('SECRET PRIVATE PATH'),false);
}

test('preflight: no CLI arguments never launches Cargo',()=>{
  expectError(run([], {noCargo:true}), 'ARGUMENTS_REQUIRED');
});
test('preflight: reject malformed or normalized UTC before Cargo',()=>{
  for (const invalid of ['2026-02-30T17:01:02.000Z','2027-06-28T00:00:00.000Z',
    '1971-12-31T23:59:59.999Z','2026-11-12T17:01:02+01:00','garbage']) {
    expectError(run([sensitivePath,invalid,'44123456','11345678','120'],{noCargo:true}),'INVALID_INPUT');
  }
});
test('preflight: reject noncanonical numeric strings or out-of-bounds locations',()=>{
  for(const [lat,lng,height] of [
    ['1e4','11345678','120'], ['44123456','NaN','120'],
    ['44123456','11345678',''], ['90000001','11345678','120'],
    ['44123456','180000001','120'], ['44123456','11345678','Infinity'],
    ['44123456','11345678','100001'],
  ]) expectError(run([sensitivePath,date,lat,lng,height],{noCargo:true}),'INVALID_INPUT');
});
test('real wrapper reports missing Cargo generically without leaking arguments',()=>{
  expectError(run(validArgs,{noCargo:true}),'NATIVE_UNAVAILABLE');
});
test('mocked Cargo: valid experimental shape passes original TypeScript receive contract',{
  skip:!mockedCargoSupported,
},()=>{
  const result=run(validArgs,{mock:true});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/DE441_SMOKE:SHAPE_VALID_EXPERIMENTAL_UNVERIFIED/);
  assert.match(result.stdout,/accuracy.*unverified/i);
  assert.equal(result.stdout.includes(sensitivePath),false);
  assert.deepEqual(result.recorded.slice(-5),validArgs);
  assert.deepEqual(result.recorded.slice(0,2),['run','--quiet']);
});
test('mocked Cargo: scientific-status promotion is rejected',{
  skip:!mockedCargoSupported,
},()=>{
  expectError(run(validArgs,{mock:true,payload:{...fixture(),scientificStatus:'validated'}}),
    'INVALID_SCIENTIFIC_CONTRACT');
});
test('mocked Cargo: missing bodies and mismatched height fail closed',{
  skip:!mockedCargoSupported,
},()=>{
  const partial=fixture();partial.positions.pop();
  expectError(run(validArgs,{mock:true,payload:partial}),'INVALID_SCIENTIFIC_CONTRACT');
  expectError(run(validArgs,{mock:true,payload:{...fixture(),heightMeters:121}}),
    'INVALID_SCIENTIFIC_CONTRACT');
});
test('mocked Cargo: malformed JSON and nonzero worker exit hide raw data',{
  skip:!mockedCargoSupported,
},()=>{
  expectError(run(validArgs,{mock:true,payload:'PRIVATE raw JSON text'}),'INVALID_SCIENTIFIC_CONTRACT');
  expectError(run(validArgs,{mock:true,mode:'nonzero'}),'NATIVE_UNAVAILABLE');
});
test('mocked Cargo: oversized stdout fails safely within bounded buffer',{
  skip:!mockedCargoSupported,
},()=>{
  expectError(run(validArgs,{mock:true,mode:'oversized'}),'NATIVE_UNAVAILABLE');
});
