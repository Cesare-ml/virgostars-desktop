import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {diagnoseEnvironment} from '../scripts/desktop-doctor.mjs';

const root = '/synthetic/virgostars-desktop';
const charts = '/synthetic/astrological-charts';
const index = join(root, 'dist', 'desktop', 'browser', 'index.html');
const exe = join(root, 'src-tauri', 'target', 'release', 'virgostars-desktop-spike.exe');

function report({stage='verify', platform='win32', nodeArch='x64', indexPresent=true, exePresent=true,
                cssInspector=()=>({stylesheets:1}),peInspector=()=>({kind:'windows_x64_gui'})}={}) {
  const files = new Set([...(indexPresent?[index]:[]),...(exePresent?[exe]:[])]);
  return diagnoseEnvironment({
    root,charts,stage,platform,nodeArch,nodeVersion:'v22.16.0',
    exists:path=>files.has(path),json:()=>null,command:()=>null,cssInspector,peInspector
  });
}
function status(r,id) {return r.checks.find(x=>x.id===id)?.status;}

test('Windows x64 verification accepts only a real local CSS report and existing PE gate',()=>{
  const result=report();
  assert.equal(status(result,'windows-architecture'),'pass');
  assert.equal(status(result,'angular-css'),'pass');
  assert.equal(status(result,'windows-pe'),'pass');
});

test('Windows ARM64 Node is blocked even when other verifiers pass',()=>{
  assert.equal(status(report({nodeArch:'arm64'}),'windows-architecture'),'blocked');
});

test('missing Angular document never runs CSS verification',()=>{
  let calls=0;
  const r=report({indexPresent:false,cssInspector:()=>{calls++;return {stylesheets:1};}});
  assert.equal(status(r,'angular-bundle'),'blocked');
  assert.equal(status(r,'angular-css'),'blocked');
  assert.equal(calls,0);
});

test('stylesheet verifier failure remains blocked and redacts exception details',()=>{
  const secret='C:/Users/example/secret-value';
  const r=report({cssInspector:()=>{throw new Error(secret);}});
  assert.equal(status(r,'angular-css'),'blocked');
  assert.doesNotMatch(JSON.stringify(r),/secret-value/);
});

test('missing or invalid Windows executable cannot pass the PE check',()=>{
  let calls=0;
  const missing=report({exePresent:false,peInspector:()=>{calls++;return {kind:'windows_x64_gui'};}});
  assert.equal(calls,0);
  assert.equal(status(missing,'windows-pe'),'blocked');
  assert.equal(status(report({peInspector:()=>({kind:'other'})}),'windows-pe'),'blocked');
  assert.equal(status(report({peInspector:()=>{throw new Error('C:/secret') } }),'windows-pe'),'blocked');
});

test('non-Windows verify uses CSS guard but not x64 or PE-only checks',()=>{
  const r=report({platform:'darwin',exePresent:false});
  assert.equal(status(r,'angular-css'),'pass');
  assert.equal(status(r,'windows-architecture'),undefined);
  assert.equal(status(r,'windows-pe'),undefined);
});

test('setup and build do not require already-generated CSS or executable',()=>{
  for (const stage of ['setup','build']) {
    const r=report({stage,indexPresent:false,exePresent:false,
      cssInspector:()=>{throw new Error('not called');},
      peInspector:()=>{throw new Error('not called');}});
    assert.equal(status(r,'angular-css'),undefined);
    assert.equal(status(r,'windows-pe'),undefined);
  }
});
