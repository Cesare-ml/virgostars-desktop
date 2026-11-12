// Verify manual v3 suite discovery never advertises partial coverage as PASS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverV3Suites, REQUIRED_SQL_SCHEMAS, REQUIRED_V3_SUITES, runV3ReferenceGate } from '../tools/v3-sqlite-reference-gate.mjs';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'virgostars-fictitious-v3-'));
  mkdirSync(join(root,'tests'),{recursive:true});
  mkdirSync(join(root,'contracts','sqlite'),{recursive:true});
  for(const file of REQUIRED_SQL_SCHEMAS) writeFileSync(join(root,'contracts','sqlite',file),'-- synthetic SQL fixture\n');
  for(const file of REQUIRED_V3_SUITES) writeFileSync(join(root,'tests',file),"import test from 'node:test';test('fictional placeholder',()=>{});\n");
  return root;
}
function useFixture(fn) {const root=fixture();try { fn(root); } finally { rmSync(root,{recursive:true,force:true}); }}
test('discovers all mandatory suites in deterministic order',()=>useFixture(root=>{const suites=discoverV3Suites(root);assert.equal(suites.length,REQUIRED_V3_SUITES.length);assert.deepEqual(suites,[...suites].sort());}));
test('fails closed when one previously verified test disappears',()=>useFixture(root=>{rmSync(join(root,'tests',REQUIRED_V3_SUITES[0]));assert.throws(()=>discoverV3Suites(root),/Mandatory v3 regression files missing/);}));
test('fails closed on missing SQL v3 schema',()=>useFixture(root=>{rmSync(join(root,'contracts','sqlite','0003_conflict_decisions.sql'));assert.throws(()=>discoverV3Suites(root),/Required versioned SQL contract missing/);}));
test('includes extra future v3 suite in sorted discovery',()=>useFixture(root=>{writeFileSync(join(root,'tests','sqlite-v3-future-case.test.mjs'),'// fictional\n');assert.equal(discoverV3Suites(root).length,REQUIRED_V3_SUITES.length+1);}));
test('refuses Node 21 before running any fixtures',()=>useFixture(root=>{assert.throws(()=>runV3ReferenceGate(root,{nodeVersion:'21.9.0'}),/Node 22\+ required/);}));
test('rejects directory disguised as a v3 test file',()=>useFixture(root=>{mkdirSync(join(root,'tests','sqlite-v3-extra.test.mjs'));assert.throws(()=>discoverV3Suites(root),/Expected test file/);}));
test('missing whole tests directory is not interpreted as no work',()=>useFixture(root=>{rmSync(join(root,'tests'),{recursive:true});assert.throws(()=>discoverV3Suites(root),/Missing tracked tests directory/);}));
test('full discovered synthetic suite executes successfully as a subprocess',()=>useFixture(root=>{assert.doesNotThrow(()=>runV3ReferenceGate(root));}));
test('failing future regression propagates a nonzero gate result',()=>useFixture(root=>{writeFileSync(join(root,'tests',REQUIRED_V3_SUITES[0]),"import test from 'node:test';test('intentional fictional failure',()=>{throw new Error('synthetic regression');});\n");assert.throws(()=>runV3ReferenceGate(root),/v3 Node reference suite FAILED/);}));
