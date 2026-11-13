import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {diagnoseEnvironment} from '../scripts/desktop-doctor.mjs';

const root = '/synthetic/virgostars-desktop';
const charts = '/synthetic/astrological-charts';
const index = join(root, 'dist', 'desktop', 'browser', 'index.html');
const exe = join(root, 'src-tauri', 'target', 'release', 'virgostars-desktop-spike.exe');

function report({stage='verify', platform='win32', nodeArch='x64', indexPresent=true, exePresent=true,
                cssInspector=()=>({stylesheets:1}),
                jsInspector=()=>({scripts:1,files:['main.js']}),
                peInspector=()=>({kind:'windows_x64_gui'})}={}) {
  const files = new Set([...(indexPresent?[index]:[]),...(exePresent?[exe]:[])]);
  return diagnoseEnvironment({
    root,charts,stage,platform,nodeArch,nodeVersion:'v22.16.0',
    exists:path=>files.has(path),json:()=>null,command:()=>null,
    cssInspector,jsInspector,peInspector
  });
}
function status(r,id) {return r.checks.find(x=>x.id===id)?.status;}

test('Windows x64 verification accepts CSS, local Angular scripts and existing PE gate',()=>{
  const result=report();
  assert.equal(status(result,'windows-architecture'),'pass');
  assert.equal(status(result,'angular-css'),'pass');
  assert.equal(status(result,'angular-js'),'pass');
  assert.equal(status(result,'windows-pe'),'pass');
});

test('Windows ARM64 Node is blocked even when other verifiers pass',()=>{
  assert.equal(status(report({nodeArch:'arm64'}),'windows-architecture'),'blocked');
});

test('missing Angular document never runs CSS or JavaScript inspection',()=>{
  let cssCalls=0, jsCalls=0;
  const r=report({indexPresent:false,
    cssInspector:()=>{cssCalls++;return {stylesheets:1};},
    jsInspector:()=>{jsCalls++;return {scripts:1,files:['main.js']};}});
  assert.equal(status(r,'angular-bundle'),'blocked');
  assert.equal(status(r,'angular-css'),'blocked');
  assert.equal(status(r,'angular-js'),'blocked');
  assert.equal(cssCalls,0);
  assert.equal(jsCalls,0);
});

test('stylesheet verifier failure remains blocked and redacts exception details',()=>{
  const secret='C:/Users/example/secret-value';
  const r=report({cssInspector:()=>{throw new Error(secret);}});
  assert.equal(status(r,'angular-css'),'blocked');
  assert.doesNotMatch(JSON.stringify(r),/secret-value/);
});

test('invalid local Angular script reports and exceptions fail without leaking paths',()=>{
  const bad=report({jsInspector:()=>{throw new Error('secret-value C:/private/script.js');}});
  assert.equal(status(bad,'angular-css'),'pass');
  assert.equal(status(bad,'angular-js'),'blocked');
  assert.doesNotMatch(JSON.stringify(bad),/secret-value|private\/script/);
  for (const result of [null, {}, {scripts:0,files:[]}, {scripts:1,files:[]},
      {scripts:2,files:['main.js']}, {scripts:3,files:['main.js','polyfills.js','extra.js']}]) {
    assert.equal(status(report({jsInspector:()=>result}),'angular-js'),'blocked');
  }
});

test('CSS and script checks independently fail closed',()=>{
  const cssBad=report({cssInspector:()=>{throw new Error('invalid stylesheet');}});
  assert.equal(status(cssBad,'angular-css'),'blocked');
  assert.equal(status(cssBad,'angular-js'),'pass');
  const jsBad=report({jsInspector:()=>({scripts:0,files:[]})});
  assert.equal(status(jsBad,'angular-css'),'pass');
  assert.equal(status(jsBad,'angular-js'),'blocked');
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
  assert.equal(status(r,'angular-js'),'pass');
  assert.equal(status(r,'windows-architecture'),undefined);
  assert.equal(status(r,'windows-pe'),undefined);
});

test('setup and build do not require already-generated CSS or executable',()=>{
  for (const stage of ['setup','build']) {
    const r=report({stage,indexPresent:false,exePresent:false,
      cssInspector:()=>{throw new Error('not called');},
      jsInspector:()=>{throw new Error('not called');},
      peInspector:()=>{throw new Error('not called');}});
    assert.equal(status(r,'angular-css'),undefined);
    assert.equal(status(r,'angular-js'),undefined);
    assert.equal(status(r,'windows-pe'),undefined);
  }
});
