import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {testProfileStatusRust} from '../scripts/test-profile-status-rust.mjs';

function isolated(check) {
  const base = mkdtempSync(join(tmpdir(), 'vs-rust-gate-fixture-'));
  try { return check(base); } finally { rmSync(base, {recursive:true,force:true}); }
}
function fakeCompiler({build={},testRun={}}={}) {
  const calls = [];
  function run(cmd,args,options) {
    calls.push({cmd,args,options});
    if(calls.length===1) return {status:0, stdout:'', ...build};
    return {status:0, stdout:'test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out', ...testRun};
  }
  return {calls,run};
}

test('standalone gate invokes rustc --test then fixed temporary binary without a shell',()=>isolated(base=>{
  const f=fakeCompiler();
  assert.deepEqual(testProfileStatusRust({run:f.run,tempBase:base}),{passed:7});
  assert.equal(f.calls.length,2);
  assert.equal(f.calls[0].cmd,'rustc');
  assert.deepEqual(f.calls[0].args.slice(0,2),['--edition=2021','--test']);
  assert.equal(f.calls[0].args[3],'-o');
  assert.equal(f.calls[1].cmd,f.calls[0].args[4]);
  assert.deepEqual(f.calls[1].args,['--test-threads=1']);
  assert.equal(f.calls[0].options.shell,false);
  assert.equal(f.calls[1].options.shell,false);
  assert.equal(existsSync(f.calls[0].args[4]),false);
  assert.deepEqual(readdirSync(base),[]);
}));

test('missing Rust compiler fails closed and cleans temporary directory',()=>isolated(base=>{
  let calls=0;
  assert.throws(()=>testProfileStatusRust({tempBase:base,run:()=>{calls++;return {error:{code:'ENOENT'},status:null}}}),/RUST_FENCE_COMPILER_UNAVAILABLE/);
  assert.equal(calls,1);
  assert.deepEqual(readdirSync(base),[]);
}));

test('compilation failure never starts an executable',()=>isolated(base=>{
  let calls=0;
  assert.throws(()=>testProfileStatusRust({tempBase:base,run:()=>{calls++;return {status:1,stderr:'private path /mock'};}}),/RUST_FENCE_COMPILATION_FAILED/);
  assert.equal(calls,1);
  assert.deepEqual(readdirSync(base),[]);
}));

test('Rust test execution failure returns a generic error and leaves no artifacts',()=>isolated(base=>{
  const f=fakeCompiler({testRun:{status:101,stderr:'sensitive'} });
  assert.throws(()=>testProfileStatusRust({tempBase:base,run:f.run}),/RUST_FENCE_EXECUTION_FAILED/);
  assert.deepEqual(readdirSync(base),[]);
}));

test('zero or incomplete Rust test output is rejected even with exit code zero',()=>isolated(base=>{
  for(const stdout of ['', 'test result: ok. 0 passed; 0 failed;', 'test result: ok. 6 passed; 0 failed;',
    'test result: ok. 7 passed; 1 failed;', 'test result: ok. 7 passed; 0 failed;\ntest result: ok. 7 passed; 0 failed;']) {
    const f=fakeCompiler({testRun:{stdout}});
    assert.throws(()=>testProfileStatusRust({tempBase:base,run:f.run}),/RUST_FENCE_TEST_COUNT_MISMATCH/);
  }
  assert.deepEqual(readdirSync(base),[]);
}));

test('signal termination and timer failure cannot be mistaken for success',()=>isolated(base=>{
  for(const data of [{status:null,signal:'SIGTERM'}, {status:0,error:{code:'ETIMEDOUT'}}]) {
    const f=fakeCompiler({testRun:data});
    assert.throws(()=>testProfileStatusRust({tempBase:base,run:f.run}),/RUST_FENCE_EXECUTION_FAILED/);
  }
  assert.deepEqual(readdirSync(base),[]);
}));

test('runner never injects remote install/download commands or user paths',()=>{
  const f=fakeCompiler();
  const result=isolated(base=>testProfileStatusRust({run:f.run,tempBase:base}));
  assert.deepEqual(result,{passed:7});
  for(const call of f.calls) {
    assert.equal(call.options.windowsHide,true);
    assert.ok(call.options.timeout > 0 && call.options.timeout <= 120000);
    assert.doesNotMatch(JSON.stringify([call.cmd,call.args]),/curl|npm|cargo|powershell|http[s]?:|sh -c/);
  }
});
