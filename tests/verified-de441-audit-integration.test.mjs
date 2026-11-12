/**
 * True three-module offline integration: all production filesystem readers and
 * numerical comparison are called, with fictional geometries and local files.
 * A passing fixture is NOT independent astronomy or source authentication.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVerifiedAuditArgs, runVerifiedDe441Audit } from '../scripts/ephemeris/run-verified-de441-audit.mjs';
import { verifyReferenceEvidence } from '../scripts/ephemeris/verify-reference-evidence.mjs';
import { auditLocalReference } from '../scripts/ephemeris/compare-de441-reference.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bodies = [
  'sun','moon','mercury','venus','mars_barycenter','jupiter_barycenter',
  'saturn_barycenter','uranus_barycenter','neptune_barycenter','pluto_barycenter',
];
const approximations = [
  'ut1_equals_utc','truncated_tdb_minus_tt','no_nutation','no_light_time',
  'no_aberration','no_gravitational_deflection','no_polar_motion',
  'no_atmospheric_refraction','outer_planet_system_barycenters',
];
const source = 'FICTITIOUS Horizons-like response. This is NOT a JPL download.\n';
const query = 'TEST_ONLY=true&COMMAND=FICTITIOUS&CENTER=FICTITIOUS\n';
const normalizer = '# FICTITIOUS non-astronomical test normalizer.\n';
const sciNote = 'Fictional self-consistent comparison only; NOT authentic JPL reference.';
const tolerance = {maxDirectionArcsec:1,maxDistancePpm:1,maxEpochSeconds:0.1};

function sky() {
  return {
    schemaVersion:1,
    utcIso:'2026-11-12T10:00:00.000Z',latMicro:44000000,lngMicro:11000000,
    heightMeters:123,observerDatum:'WGS84',frame:'mean_ecliptic_and_equatorial_of_date',
    geometry:'topocentric_geometric',ttJulianDay:2460997.0007,
    tdbJulianDay:2460997.0007,taiMinusUtcSeconds:37,
    approximations:[...approximations],
    positions:bodies.map((bodyId,i)=>({bodyId,
      centerKind:bodyId.endsWith('_barycenter')?'system_barycenter':'body_center',
      longitudeDeg:i*32+1,latitudeDeg:2,
      rightAscensionDeg:i*33+1,declinationDeg:4,
      altitudeDeg:25,azimuthDeg:35,
      distanceKm:100000000+i*5000,
    })),
  };
}
function syntheticDocuments() {
  const common=sky();
  return {
    actual:{...structuredClone(common),scientificStatus:'experimental_unverified',
      provider:'VirgoStars-Ephemeris',sourceFormat:'DE441_classic_binary',kernelSha256:'a'.repeat(64)},
    reference:{...structuredClone(common),provenance:{
      source:'JPL_HORIZONS',rawResponseSha256:sha(source),querySha256:sha(query),
      normalizationCodeSha256:sha(normalizer),normalizationNotes:sciNote,
    }},
  };
}
async function fixture(run) {
  const folder=await mkdtemp(join(tmpdir(),'vs-de441-real-e2e-'));
  const paths={
    actual:join(folder,'fictional-actual.json'),
    reference:join(folder,'fictional-reference.json'),
    rawSource:join(folder,'fictional-source.txt'),
    rawQuery:join(folder,'fictional-query.txt'),
    normalizerSource:join(folder,'fictional-normalizer.py'),
  };
  const docs=syntheticDocuments();
  try {
    await Promise.all([
      writeFile(paths.actual,JSON.stringify(docs.actual)),
      writeFile(paths.reference,JSON.stringify(docs.reference)),
      writeFile(paths.rawSource,source),writeFile(paths.rawQuery,query),
      writeFile(paths.normalizerSource,normalizer),
    ]);
    await run(paths,docs,folder);
  } finally { await rm(folder,{force:true,recursive:true}); }
}
function args(paths) {
  return [
    '--actual',paths.actual,'--reference',paths.reference,'--raw-source',paths.rawSource,
    '--raw-query',paths.rawQuery,'--normalizer-source',paths.normalizerSource,
    '--max-direction-arcsec',String(tolerance.maxDirectionArcsec),
    '--max-distance-ppm',String(tolerance.maxDistancePpm),
    '--max-epoch-seconds',String(tolerance.maxEpochSeconds),
  ];
}
const audit = paths => runVerifiedDe441Audit(parseVerifiedAuditArgs(args(paths)));
const script=fileURLToPath(new URL('../scripts/ephemeris/run-verified-de441-audit.mjs',import.meta.url));
const cli = paths => spawnSync(process.execPath,[script,...args(paths)],{encoding:'utf8',maxBuffer:65536});
const noLeaks = (processResult,paths) => {
  const output=processResult.stdout+processResult.stderr;
  for(const value of Object.values(paths)) assert.ok(!output.includes(value),'input path leaked');
  assert.ok(!output.includes('44000000'),'coordinates leaked');
  assert.ok(!output.includes('2026-11-12T10:00'),'timestamp leaked');
  assert.ok(!output.includes('FICTITIOUS'),'raw source leaked');
};

test('REAL modules: complete fictional evidence -> numeric check -> evidence accepts experimental-only',
  async()=>fixture(async paths=>{
    const report=await audit(paths);
    assert.deepEqual(report,{
      status:'REVIEW_WITHIN_TOLERANCE_EXPERIMENTAL',
      maxDirectionArcsec:0,maxDistancePpm:0,maxEpochSeconds:0,
      scientificallyValidated:false,
    });
  }));

test('REAL CLI: synthetic complete audit exits zero with status and no sensitive file paths',
  async()=>fixture(async paths=>{
    const result=cli(paths);
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/REVIEW_WITHIN_TOLERANCE_EXPERIMENTAL/);
    assert.match(result.stdout,/not JPL authentication/);
    noLeaks(result,paths);
  }));

test('REAL modules: different ecliptic longitude fails scientific tolerance but remains experimental',
  async()=>fixture(async (paths,docs)=>{
    docs.actual.positions[0].longitudeDeg+=0.5;
    await writeFile(paths.actual,JSON.stringify(docs.actual));
    const report=await audit(paths);
    assert.equal(report.status,'REVIEW_OUTSIDE_TOLERANCE_EXPERIMENTAL');
    assert.ok(report.maxDirectionArcsec>100);
    assert.equal(report.scientificallyValidated,false);
  }));

test('REAL CLI: numerical mismatch exits nonzero without revealing source records',
  async()=>fixture(async (paths,docs)=>{
    docs.actual.positions[0].rightAscensionDeg+=0.25;
    await writeFile(paths.actual,JSON.stringify(docs.actual));
    const result=cli(paths);
    assert.equal(result.status,1);
    assert.match(result.stdout,/REVIEW_OUTSIDE_TOLERANCE_EXPERIMENTAL/);
    noLeaks(result,paths);
  }));

test('REAL modules: wrong observer / geometric frame makes comparison invalid',
  async()=>fixture(async (paths,docs)=>{
    docs.reference.lngMicro+=1;
    await writeFile(paths.reference,JSON.stringify(docs.reference));
    assert.deepEqual(await audit(paths),{
      status:'REVIEW_BLOCKED',reason:'COMPARISON_INVALID',scientificallyValidated:false,
    });
  }));

test('REAL modules: query edit blocks before comparison, never passes based on numeric agreement',
  async()=>fixture(async paths=>{
    await writeFile(paths.rawQuery,'altered query: fictional sensitive coordinates');
    assert.deepEqual(await audit(paths),{
      status:'REVIEW_BLOCKED',reason:'EVIDENCE_REJECTED',scientificallyValidated:false,
    });
  }));

test('REAL modules: normalizer edit blocks audit',
  async()=>fixture(async paths=>{
    await writeFile(paths.normalizerSource,normalizer+'# corrupted');
    assert.equal((await audit(paths)).reason,'EVIDENCE_REJECTED');
  }));

test('REAL modules: original source edit blocks audit',
  async()=>fixture(async paths=>{
    await writeFile(paths.rawSource,source+'corrupt');
    assert.equal((await audit(paths)).reason,'EVIDENCE_REJECTED');
  }));

test('REAL CLI: tampered evidence exits with sanitized fixed reason',
  async()=>fixture(async paths=>{
    await writeFile(paths.rawQuery,'DO NOT PRINT THIS PRIVATE TEST STRING');
    const result=cli(paths);
    assert.equal(result.status,1);
    assert.match(result.stderr,/REVIEW_BLOCKED|EVIDENCE_REJECTED/);
    assert.doesNotMatch(result.stdout+result.stderr,/DO NOT PRINT THIS PRIVATE TEST STRING/);
    noLeaks(result,paths);
  }));

test('REAL modules: unrecognized source or counterfeit scientific status never approves',
  async()=>fixture(async (paths,docs)=>{
    docs.actual.scientificStatus='validated';
    await writeFile(paths.actual,JSON.stringify(docs.actual));
    assert.equal((await audit(paths)).reason,'COMPARISON_INVALID');
    docs.actual.scientificStatus='experimental_unverified';
    docs.reference.provenance.source='VirgoStars-Ephemeris';
    await Promise.all([writeFile(paths.actual,JSON.stringify(docs.actual)),
      writeFile(paths.reference,JSON.stringify(docs.reference))]);
    assert.equal((await audit(paths)).reason,'EVIDENCE_REJECTED');
  }));

test('REAL modules: mismatched raw-response file reused as query is refused',
  async()=>fixture(async paths=>{
    assert.equal((await audit({...paths,rawQuery:paths.rawSource})).reason,'EVIDENCE_REJECTED');
  }));

test('REAL modules: symlink query and missing files refuse by the actual filesystem readers',
  async()=>fixture(async (paths,_docs,folder)=>{
    const link=join(folder,'linked.txt');
    await symlink(paths.rawQuery,link);
    assert.equal((await audit({...paths,rawQuery:link})).reason,'EVIDENCE_REJECTED');
    await rm(paths.normalizerSource);
    assert.equal((await audit(paths)).reason,'EVIDENCE_REJECTED');
  }));

test('REAL numeric reader: an oversized reference cannot be accepted',
  async()=>fixture(async paths=>{
    await writeFile(paths.reference,' '.repeat(128*1024+1));
    assert.equal((await audit(paths)).reason,'EVIDENCE_REJECTED');
  }));

test('REAL modules + intentional mid-audit edit: second evidence gate catches changed query',
  async()=>fixture(async paths=>{
    let compareCalled=0;
    const parsed=parseVerifiedAuditArgs(args(paths));
    const report=await runVerifiedDe441Audit(parsed,{
      verify:verifyReferenceEvidence,
      compare:async (...arg)=>{
        compareCalled++;
        const result=await auditLocalReference(...arg);
        await writeFile(paths.rawQuery,query+'POST COMPARISON EDIT');
        return result;
      },
    });
    assert.equal(compareCalled,1);
    assert.deepEqual(report,{
      status:'REVIEW_BLOCKED',reason:'EVIDENCE_CHANGED',scientificallyValidated:false,
    });
  }));

test('REAL modules: changing the saved reference itself during audit blocks second evidence check',
  async()=>fixture(async paths=>{
    const parsed=parseVerifiedAuditArgs(args(paths));
    const report=await runVerifiedDe441Audit(parsed,{
      verify:verifyReferenceEvidence,
      compare:async (...arg)=>{
        const result=await auditLocalReference(...arg);
        await writeFile(paths.reference,(await readFile(paths.reference,'utf8')).replace(
          'Fictional self-consistent','Tampered  self-consistent'));
        return result;
      },
    });
    // A reference JSON edit that keeps every claimed upstream digest valid
    // must still cause a conservative failure of the combined audit.
    assert.equal(report.status,'REVIEW_BLOCKED');
    assert.equal(report.reason,'EVIDENCE_CHANGED');
  }));

test('REAL modules: replacing experimental sky JSON during comparison blocks final snapshot integrity',
  async()=>fixture(async paths=>{
    const parsed=parseVerifiedAuditArgs(args(paths));
    const result=await runVerifiedDe441Audit(parsed,{
      verify:verifyReferenceEvidence,
      compare:async (...input)=>{
        const comparison=await auditLocalReference(...input);
        const modified=JSON.parse(await readFile(paths.actual,'utf8'));
        modified.positions[0].longitudeDeg+=0.25;
        await writeFile(paths.actual,JSON.stringify(modified));
        return comparison;
      },
    });
    assert.equal(result.status,'REVIEW_BLOCKED');
    assert.equal(result.reason,'SNAPSHOT_CHANGED');
  }));
test('REAL modules: missing or symlinked experimental snapshot fails before numeric comparison',
  async()=>fixture(async(paths,_docs,folder)=>{
    const link=join(folder,'sky-linked.json');await symlink(paths.actual,link);
    assert.equal((await audit({...paths,actual:link})).reason,'SNAPSHOT_UNAVAILABLE');
    await rm(paths.actual);
    assert.equal((await audit(paths)).reason,'SNAPSHOT_UNAVAILABLE');
  }));
test('REAL modules: corrupted but valid-sized experimental input cannot be promoted to ready',
  async()=>fixture(async paths=>{
    await writeFile(paths.actual,'{invalid JSON');
    assert.equal((await audit(paths)).reason,'REVIEW_UNAVAILABLE');
  }));
