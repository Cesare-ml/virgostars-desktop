// Synthetic-only fixture tests for the manual source integrity preflight.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {gitBlobSha1, verifyV3SourceLock, V3_SOURCE_LOCK} from '../tools/v3-verify-source-lock.mjs';
import {REQUIRED_V3_SUITES, REQUIRED_SQL_SCHEMAS} from '../tools/v3-sqlite-reference-gate.mjs';

function fixture(fn) {
  const root=mkdtempSync(join(tmpdir(),'virgostars-v3-lock-fixture-'));
  const files={};
  try {
    mkdirSync(join(root,'tests'),{recursive:true});
    mkdirSync(join(root,'contracts','sqlite'),{recursive:true});
    for(const path of [
      ...REQUIRED_V3_SUITES.map((name)=>`tests/${name}`),
      ...REQUIRED_SQL_SCHEMAS.map((name)=>`contracts/sqlite/${name}`),
    ]) {
      const source=path.endsWith('.sql')?'-- synthetic schema fixture\n':
        "import test from 'node:test';test('fictional regression',()=>{});\n";
      writeFileSync(join(root,...path.split('/')),source);
      files[path]=gitBlobSha1(Buffer.from(source));
    }
    const save=()=>writeFileSync(join(root,...V3_SOURCE_LOCK.split('/')),JSON.stringify({format:'virgostars-v3-reference-git-blobs-v1',files},null,2));
    save();
    fn({root,files,save});
  } finally {rmSync(root,{recursive:true,force:true});}
}

test('git-compatible blob hash matches the known empty blob',()=>{
  assert.equal(gitBlobSha1(Buffer.alloc(0)),'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
});
test('valid reviewed lock covers all eleven suites and three SQL schemas',()=>fixture(({root})=>{
  assert.deepEqual(verifyV3SourceLock(root),{suites:11,checked:14});
}));
test('changing one byte of a reviewed SQL contract fails',()=>fixture(({root})=>{
  writeFileSync(join(root,'contracts','sqlite','0003_conflict_decisions.sql'),'-- forged synthetic schema\n');
  assert.throws(()=>verifyV3SourceLock(root),/v3 source drift/);
}));
test('changing a test fixture without updating its reviewed hash fails',()=>fixture(({root})=>{
  writeFileSync(join(root,'tests',REQUIRED_V3_SUITES[0]),"import test from 'node:test';test('changed',()=>{});\n");
  assert.throws(()=>verifyV3SourceLock(root),/v3 source drift/);
}));
test('missing source lock fails closed',()=>fixture(({root})=>{
  rmSync(join(root,...V3_SOURCE_LOCK.split('/')));
  assert.throws(()=>verifyV3SourceLock(root),/Missing reviewed v3 source lock/);
}));
test('new future v3 suite requires an explicit reviewed hash',()=>fixture(({root})=>{
  writeFileSync(join(root,'tests','sqlite-v3-added.test.mjs'),"import test from 'node:test';test('new',()=>{});\n");
  assert.throws(()=>verifyV3SourceLock(root),/does not cover exactly/);
}));
test('new future suite passes after deliberate manifest update',()=>fixture(({root,files,save})=>{
  const path='tests/sqlite-v3-added.test.mjs';const code="import test from 'node:test';test('new',()=>{});\n";
  writeFileSync(join(root,...path.split('/')),code);files[path]=gitBlobSha1(Buffer.from(code));save();
  assert.deepEqual(verifyV3SourceLock(root),{suites:12,checked:15});
}));
test('malformed or unknown lock keys cause refusal',()=>fixture(({root,files,save})=>{
  files['../outside.sql']='0'.repeat(40);save();
  assert.throws(()=>verifyV3SourceLock(root),/does not cover exactly/);
}));
test('malformed fingerprint is rejected',()=>fixture(({root,files,save})=>{
  files['contracts/sqlite/0003_conflict_decisions.sql']='not-a-blob';save();
  assert.throws(()=>verifyV3SourceLock(root),/Invalid v3 git blob fingerprint/);
}));
test('tampered lock format is rejected',()=>fixture(({root})=>{
  writeFileSync(join(root,...V3_SOURCE_LOCK.split('/')),JSON.stringify({format:'unknown',files:{}}));
  assert.throws(()=>verifyV3SourceLock(root),/Invalid reviewed v3 source lock format/);
});
