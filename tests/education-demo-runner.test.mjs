import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const runner=fileURLToPath(new URL('../scripts/qa/education-demo-runner.mjs',import.meta.url));
const invoke=(...args)=>spawnSync(process.execPath,[runner,...args],{
  encoding:'utf8',timeout:30000,env:{...process.env,NODE_OPTIONS:''},
});
const passing="import test from 'node:test';\ntest('synthetic fixture passes',()=>{});\n";
const failing="import test from 'node:test';\ntest('synthetic fixture fails',()=>{throw Error('synthetic fail')});\n";

function workspace(){
  const base=mkdtempSync(join(tmpdir(),'virgostars-education-qa-'));
  const root=join(base,'virgostars-desktop'),functions=join(base,'astrological-functions');
  mkdirSync(join(root,'tests'),{recursive:true});
  mkdirSync(join(root,'node_modules'),{recursive:true});
  mkdirSync(join(functions,'test'),{recursive:true});
  writeFileSync(join(root,'package.json'),'{"type":"module"}\n');
  writeFileSync(join(functions,'package.json'),'{"type":"module"}\n');
  const put=(a=passing,b=passing)=>{
    writeFileSync(join(functions,'test/zodiac-midpoint-pipeline-integration.test.mjs'),a);
    writeFileSync(join(root,'tests/return-search-contract.test.mjs'),b);
  };
  return {base,root,put,cleanup:()=>rmSync(base,{recursive:true,force:true})};
}

test('help reports safe local scope and no release certification',()=>{
  const p=invoke('--help');
  assert.equal(p.status,0,p.stderr);
  assert.match(p.stdout,/Never marks a demo release-ready/);
});

test('dry-run labels absent dependencies and unavailable algorithms honestly',()=>{
  const w=workspace();
  try {
    const dest=join(w.base,'report.json');
    const p=invoke('--root',w.root,'--only','QA-02,QA-11','--out',dest);
    assert.equal(p.status,0,p.stderr);
    const report=JSON.parse(readFileSync(dest,'utf8'));
    assert.equal(report.execution,'dry-run');
    assert.deepEqual(report.cases.map(c=>c.id),['QA-02','QA-11']);
    assert.equal(report.cases[0].status,'BLOCKED_ENV');
    assert.equal(report.cases[1].status,'BLOCKED_CAPABILITY');
  } finally {w.cleanup()}
});

test('missing or invalid option values fail; no silent zero-case pass',()=>{
  const invalid=[['--only'],['--only',''],['--only','QA-99'],['--only','QA-06,'],['--only','--run'],['--root'],['--out']];
  for(const args of invalid) assert.notEqual(invoke(...args).status,0);
});

test('real named synthetic tests pass while manual gate remains required',()=>{
  const w=workspace();
  try {
    w.put();
    const dest=join(w.base,'report.json');
    const p=invoke('--run','--root',w.root,'--only','QA-06','--out',dest);
    assert.equal(p.status,0,p.stderr+'\n'+p.stdout);
    const cases=JSON.parse(readFileSync(dest,'utf8')).cases;
    assert.equal(cases.length,1);
    assert.equal(cases[0].status,'AUTOMATED_PARTIAL_MANUAL_REQUIRED');
    assert.deepEqual(cases[0].checks.map(c=>c.status),['PASS_AUTOMATED','PASS_AUTOMATED']);
    assert.deepEqual(cases[0].checks.map(c=>c.testCount),[1,1]);
    assert.ok(cases[0].manualGate);
  } finally {w.cleanup()}
});

test('zero-exit file containing no test() never counts as passed',()=>{
  const w=workspace();
  try {
    w.put('process.exit(0);\n');
    const dest=join(w.base,'report.json');
    const p=invoke('--run','--root',w.root,'--only','QA-06','--out',dest);
    assert.equal(p.status,1,p.stderr+'\n'+p.stdout);
    const result=JSON.parse(readFileSync(dest,'utf8')).cases[0];
    assert.equal(result.status,'FAILED_AUTOMATED');
    assert.match(result.checks[0].note,/INCOMPLETE_TEST_EVIDENCE/);
  } finally {w.cleanup()}
});

test('failing named child test never produces a green report',()=>{
  const w=workspace();
  try {
    w.put(failing);
    const dest=join(w.base,'report.json');
    const p=invoke('--run','--root',w.root,'--only','QA-06','--out',dest);
    assert.equal(p.status,1,p.stderr+'\n'+p.stdout);
    const result=JSON.parse(readFileSync(dest,'utf8')).cases[0];
    assert.equal(result.status,'FAILED_AUTOMATED');
    assert.equal(result.checks[0].status,'FAILED_AUTOMATED');
    assert.equal(Object.hasOwn(result.checks[0],'stdoutTail'),false);
    assert.equal(Object.hasOwn(result.checks[0],'stderrTail'),false);
  } finally {w.cleanup()}
});

test('only skipped tests are blocked from passing',()=>{
  const w=workspace();
  try {
    w.put("import test from 'node:test';\ntest.skip('skipped',()=>{});\n");
    const dest=join(w.base,'report.json');
    const p=invoke('--run','--root',w.root,'--only','QA-06','--out',dest);
    assert.equal(p.status,1,p.stderr+'\n'+p.stdout);
    assert.equal(JSON.parse(readFileSync(dest,'utf8')).cases[0].status,'FAILED_AUTOMATED');
  } finally {w.cleanup()}
});

test('unimplemented profections and firdaria remain blocked',()=>{
  const p=invoke('--run','--root','/absent/virgostars-desktop','--only','QA-11');
  assert.equal(p.status,2,p.stderr);
  assert.match(p.stdout,/QA-11 BLOCKED_CAPABILITY/);
});

test('no sibling test files cannot be mistaken for passing QA',()=>{
  const w=workspace();
  try {
    const p=invoke('--run','--root',w.root,'--only','QA-06');
    assert.equal(p.status,2,p.stderr);
    assert.match(p.stdout,/BLOCKED_ENV/);
  } finally {w.cleanup()}
});
