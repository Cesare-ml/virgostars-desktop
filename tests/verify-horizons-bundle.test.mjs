import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildHorizonsVectorPlan } from '../scripts/ephemeris/prepare-horizons-vector-plan.mjs';
import { acquireHorizonsVectors } from '../scripts/ephemeris/acquire-horizons-vectors.mjs';
import { verifyHorizonsBundle } from '../scripts/ephemeris/verify-horizons-bundle.mjs';

const jd='2460000.500000';
const plan=()=>buildHorizonsVectorPlan(jd);
const p=plan();
function rawResponse(req) {
  // Fake HTTP payload, definitely not authenticated JPL astronomy.
  return [
    'API VERSION: 1.0', 'API SOURCE: NASA/JPL Horizons API','',
    'Ephemeris / WWW_USER / synthetic only',
    'Target body name: Test body ('+req.naifId+') {source: DE441}',
    'Center body name: Solar System Barycenter (0) {source: DE441}',
    'Center-site name: BODY CENTER','Start time: A.D. 2023-Feb-25 00:00:00.0000 TDB',
    'Output units: KM-S','Output type: GEOMETRIC cartesian states',
    'Output format: 2 (position and velocity)',
    'Reference frame: ICRF/J2000.0',
    'Coordinate systm: Earth Mean Equator and Equinox of Reference Epoch',
    'JDTDB, Calendar Date (TDB), X, Y, Z, VX, VY, VZ',
    '$$SOE',
    '2460000.500000000, A.D. 2023-Feb-25 00:00:00.0000, 1.2E+07, -2.3E+06, 3.2E+05, 1.2E+01, -4.5E+00, 0.0E+00,',
    '$$EOE','',
  ].join('\n');
}
async function fixture(run) {
  const dir=await mkdtemp(join(tmpdir(),'vs-horizons-bundle-'));
  const planPath=join(dir,'plan.json'),output=join(dir,'responses');
  try {
    await writeFile(planPath,JSON.stringify(p));
    const fetchFn=async url=>{
      const req=p.requests.find(q=>q.url===url);
      assert.ok(req);
      return new Response(rawResponse(req),{status:200});
    };
    await acquireHorizonsVectors(planPath,output,{fetchFn,pauseFn:async()=>{},pauseMs:0});
    await run({dir,planPath,output});
  } finally {await rm(dir,{recursive:true,force:true});}
}
const audit=({planPath,output})=>verifyHorizonsBundle(planPath,output);
async function mutateManifest(output,edit) {
  const path=join(output,'response-manifest.json');
  const obj=JSON.parse(await readFile(path,'utf8'));
  edit(obj);
  await writeFile(path,JSON.stringify(obj));
}

test('real acquisition and offline bundle audit: exactly ten responses verified',async()=>fixture(async paths=>{
  assert.deepEqual(await audit(paths),{
    status:'BUNDLE_INTEGRITY_OK_UNAUTHENTICATED',count:10,
    scientificallyValidated:false,sourceAuthenticated:false,
  });
}));
test('real CLI validates complete local bundle without network',async()=>fixture(async paths=>{
  const script=fileURLToPath(new URL('../scripts/ephemeris/verify-horizons-bundle.mjs',import.meta.url));
  const proc=spawnSync(process.execPath,[script,'--plan',paths.planPath,'--output-dir',paths.output],{encoding:'utf8'});
  assert.equal(proc.status,0,proc.stderr);
  assert.match(proc.stdout,/BUNDLE_INTEGRITY_OK_UNAUTHENTICATED/);
  assert.doesNotMatch(proc.stdout+proc.stderr,/2460000.5|vs-horizons-bundle-/);
}));
test('file mutation fails the original response SHA-256 check',async()=>fixture(async paths=>{
  const path=join(paths.output,p.requests[0].responseFilename);
  await writeFile(path,(await readFile(path,'utf8')).replace('1.2E+07','1.3E+07'));
  assert.equal((await audit(paths)).reason,'RESPONSE_DIGEST_MISMATCH');
}));
test('reordered vector files fail despite superficially matching format',async()=>fixture(async paths=>{
  const a=join(paths.output,p.requests[0].responseFilename);
  const b=join(paths.output,p.requests[1].responseFilename);
  const t=await readFile(a),v=await readFile(b);
  await Promise.all([writeFile(a,v),writeFile(b,t)]);
  assert.equal((await audit(paths)).reason,'RESPONSE_DIGEST_MISMATCH');
}));
test('edited query digest and original-response digest are rejected',async()=>fixture(async paths=>{
  await mutateManifest(paths.output,m=>m.responses[0].queryUrlSha256='0'.repeat(64));
  assert.equal((await audit(paths)).reason,'MANIFEST_MISMATCH');
  await mutateManifest(paths.output,m=>m.responses[0].queryUrlSha256='bad');
  assert.equal((await audit(paths)).reason,'MANIFEST_MISMATCH');
}));
test('extraneous manifest fields or falsely authenticated status are rejected',async()=>fixture(async paths=>{
  await mutateManifest(paths.output,m=>{m.scientificallyValidated=true;});
  assert.equal((await audit(paths)).reason,'MANIFEST_MISMATCH');
  await mutateManifest(paths.output,m=>{delete m.scientificallyValidated;m.status='VALIDATED';});
  assert.equal((await audit(paths)).reason,'MANIFEST_MISMATCH');
}));
test('missing or reordered target record cannot be silently accepted',async()=>fixture(async paths=>{
  await mutateManifest(paths.output,m=>{m.responses.reverse();});
  assert.equal((await audit(paths)).reason,'MANIFEST_MISMATCH');
}));
test('unexpected file in acquisition directory is rejected',async()=>fixture(async paths=>{
  await writeFile(join(paths.output,'unreviewed-private.txt'),'private');
  assert.equal((await audit(paths)).reason,'UNEXPECTED_FILE');
}));
test('deleted response produces a safe failure without revealing file path',async()=>fixture(async paths=>{
  await rm(join(paths.output,p.requests[0].responseFilename));
  const report=await audit(paths);
  assert.equal(report.status,'BUNDLE_REJECTED');
  assert.doesNotMatch(JSON.stringify(report),/vs-horizons-bundle-/);
}));
test('symlink response files and symlinked output directory are rejected',async()=>fixture(async paths=>{
  const target=join(paths.output,p.requests[0].responseFilename);
  const backup=join(paths.dir,'backup.txt');
  await writeFile(backup,await readFile(target));
  await rm(target);await symlink(backup,target);
  assert.equal((await audit(paths)).reason,'INVALID_OR_UNSAFE_RESPONSE');
  const link=join(paths.dir,'linked-directory');await symlink(paths.output,link);
  assert.equal((await audit({...paths,output:link})).reason,'UNSAFE_OUTPUT_DIRECTORY');
}));
test('invalid or altered query plan is rejected before reading responses',async()=>fixture(async paths=>{
  const altered=plan();altered.requests[0].url='https://example.invalid';
  await writeFile(paths.planPath,JSON.stringify(altered));
  assert.equal((await audit(paths)).reason,'NONCANONICAL_PLAN');
}));
test('wrong response hash even when record is valid hex is rejected',async()=>fixture(async paths=>{
  await mutateManifest(paths.output,m=>m.responses[0].originalResponseSha256='f'.repeat(64));
  assert.equal((await audit(paths)).reason,'RESPONSE_DIGEST_MISMATCH');
}));
test('tampered body provenance or unknown record fields rejected',async()=>fixture(async paths=>{
  await mutateManifest(paths.output,m=>{m.responses[0].sourceClaim='DE440';});
  assert.equal((await audit(paths)).reason,'MANIFEST_MISMATCH');
  await mutateManifest(paths.output,m=>{m.responses[0].sourceClaim='DE441';m.responses[0].userBirth='private';});
  assert.equal((await audit(paths)).reason,'MANIFEST_MISMATCH');
}));
test('truncated binary or malformed UTF-8 response is rejected',async()=>fixture(async paths=>{
  const path=join(paths.output,p.requests[0].responseFilename);
  await writeFile(path,Buffer.from([0xc3,0x28]));
  assert.equal((await audit(paths)).reason,'RESPONSE_DIGEST_MISMATCH');
}));
test('invalid args fail without opening a network socket',async()=>{
  const report=await verifyHorizonsBundle('','');
  assert.deepEqual(report,{status:'BUNDLE_REJECTED',reason:'INVALID_ARGUMENTS',scientificallyValidated:false});
});
