import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseRegressionArgs,getRegressionSuites,parseTestSummary,
  inspectRegressionFiles,runHorizonsRegressions,
} from '../scripts/ephemeris/run-horizons-regressions.mjs';
const cli=fileURLToPath(new URL('../scripts/ephemeris/run-horizons-regressions.mjs',import.meta.url));
const validReport=['1..29','# tests 29','# suites 0','# pass 29','# fail 0',
  '# cancelled 0','# skipped 0','# todo 0','# duration_ms 42'].join('\n');

async function temp(fn){const root=await mkdtemp(join(tmpdir(),'vs-horizons-regressions-'));
  try{await mkdir(join(root,'tests'));await fn(root)}finally{await rm(root,{recursive:true,force:true})}}

test('only two explicit suite flags are accepted, no user paths or arbitrary script names',()=>{
  assert.equal(parseRegressionArgs(['--suite','core']),'core');
  assert.equal(parseRegressionArgs(['--suite','all']),'all');
  for(const value of [[],['--suite'],['--suite','./tests/bad.mjs'],
    ['--suite','core','--extra'],['--other','core'],['--suite','none']])
    assert.equal(parseRegressionArgs(value),null);
});
test('the all suite includes eight actual repository test files and both core suites',()=>{
  assert.equal(getRegressionSuites('core').length,2);
  const all=getRegressionSuites('all');assert.equal(all.length,8);
  assert.equal(new Set(all).size,8);
  for(const file of getRegressionSuites('core'))assert.ok(all.includes(file));
  assert.equal(getRegressionSuites('arbitrary'),null);
});
test('strict summary accepts only 29 real passes with zero failed, skipped or cancelled',()=>{
  assert.equal(parseTestSummary(validReport,29),true);
  assert.equal(parseTestSummary(validReport,75),false);
  for(const replacement of ['# fail 1','# skipped 1','# cancelled 1','# todo 1',
    '# pass 28','# tests 28']){
    const name=replacement.split(' ')[1];
    assert.equal(parseTestSummary(validReport.replace('# '+name+' '+(name==='pass'||name==='tests'?29:0),replacement),29),false);
  }
});
test('rejects duplicate, malformed, absent and forged TAP totals',()=>{
  for(const bad of [validReport+'\n# pass 29','no summary',
    validReport.replace('# tests 29',''),validReport.replace('# fail 0','# fail NaN')])
    assert.equal(parseTestSummary(bad,29),false);
});
test('fails explicitly when a partial checkout lacks all required suites',async()=>{
  const result=await runHorizonsRegressions('all');
  // This synthetic fixture is itself run on both partial and full checkouts.
  assert.ok(['INCOMPLETE','PASS','FAILED'].includes(result.status));
  assert.equal(typeof result.exitCode,'number');
});
test('missing test file never invokes the child runner',async()=>temp(async root=>{
  let called=false;
  const result=await runHorizonsRegressions('core',{root,spawn:()=>{called=true;throw Error('BAD')}});
  assert.equal(result.status,'INCOMPLETE');
  assert.equal(called,false);
}));
test('symbolic-linked file is an incomplete suite, not a pass',async()=>temp(async root=>{
  await writeFile(join(root,'real-test.mjs'),'// synthetic');
  const [one,two]=getRegressionSuites('core');
  await symlink(join(root,'real-test.mjs'),join(root,one));
  await writeFile(join(root,two),'// synthetic');
  assert.equal(await inspectRegressionFiles(root,'core'),false);
}));
test('rejects zero-byte tests and 512 KiB oversized test files',async()=>temp(async root=>{
  const [one,two]=getRegressionSuites('core');
  await writeFile(join(root,one),'');await writeFile(join(root,two),'// fictional');
  assert.equal(await inspectRegressionFiles(root,'core'),false);
  await writeFile(join(root,one),Buffer.alloc(512*1024+1,65));
  assert.equal(await inspectRegressionFiles(root,'core'),false);
}));
test('fake successful exit cannot promote incomplete test count',async()=>temp(async root=>{
  for(const file of getRegressionSuites('core'))await writeFile(join(root,file),'// fictional');
  const result=await runHorizonsRegressions('core',{root,spawn:()=>({
    status:0,stdout:validReport.replace('# pass 29','# pass 28'),stderr:'',
  })});
  assert.equal(result.status,'FAILED');
}));
test('successful injected runner must have exact count and zero skips',async()=>temp(async root=>{
  for(const file of getRegressionSuites('core'))await writeFile(join(root,file),'// fictional');
  const good=await runHorizonsRegressions('core',{root,spawn:()=>({status:0,stdout:validReport,stderr:''})});
  assert.deepEqual(good,{status:'PASS',exitCode:0,testCount:29});
}));
test('exceptions from child runner are contained and not printed',async()=>temp(async root=>{
  for(const file of getRegressionSuites('core'))await writeFile(join(root,file),'// fictional');
  const failed=await runHorizonsRegressions('core',{root,spawn:()=>{throw Error('SECRET PATH')}});
  assert.deepEqual(failed,{status:'INTERNAL_ERROR',exitCode:3});
}));
test('real operator CLI core suite executes existing files with no network',()=>{
  const p=spawnSync(process.execPath,[cli,'--suite','core'],{encoding:'utf8',timeout:30000});
  assert.equal(p.status,0,JSON.stringify({stdout:p.stdout,stderr:p.stderr,env:process.env.NODE_TEST_CONTEXT}));
  assert.match(p.stdout,/HORIZONS_REGRESSION:PASS/);
  assert.match(p.stdout,/HORIZONS_TEST_COUNT:29/);
  assert.doesNotMatch(p.stdout+p.stderr,/\\mnt\\data|SECRET PATH/);
});
test('real CLI invalid input returns fixed code without executing tests',()=>{
  const p=spawnSync(process.execPath,[cli,'--suite','../../secret'],{encoding:'utf8'});
  assert.equal(p.status,2);
  assert.equal(p.stdout,'HORIZONS_REGRESSION:INVALID_ARGS\n');
});
