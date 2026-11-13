import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {diagnoseEnvironment, formatReport} from '../scripts/desktop-doctor.mjs';

const root = '/synthetic/desktop';
const binary = join(root,'src-tauri','target','release','virgostars-desktop-spike.exe');
const html = join(root,'dist','desktop','browser','index.html');
function run({stage='verify', platform='win32', present=true, result={format:'PE32+',machine:'AMD64'}, inspect}={}) {
  return diagnoseEnvironment({
    root, charts:'/synthetic/charts', stage, platform,
    nodeArch:'x64', nodeVersion:'v22.16.0',
    exists:path=>path===html || (present && path===binary),
    json:()=>null, command:()=>null,
    cssInspector:()=>({stylesheets:1}),
    peInspector:inspect || (()=>result),
  });
}
const status=(r,id)=>r.checks.find(x=>x.id===id)?.status;

test('Windows verify recognizes an explicitly identified PE32+ AMD64 binary',()=>{
  let called=0;
  const r=run({inspect:path=>{
    called++;
    assert.equal(path,binary);
    return {format:'PE32+',machine:'AMD64'};
  }});
  assert.equal(status(r,'windows-executable'),'pass');
  assert.equal(status(r,'windows-pe'),'pass');
  assert.equal(called,1);
});

test('missing Windows executable blocks PE without opening a file',()=>{
  const r=run({present:false,inspect:()=>{throw Error('must not run');}});
  assert.equal(status(r,'windows-executable'),'blocked');
  assert.equal(status(r,'windows-pe'),'blocked');
});

test('wrong PE architecture or malformed inspector response fails closed',()=>{
  for(const result of [
    {format:'PE32',machine:'I386'}, {format:'PE32+',machine:'ARM64'},
    {format:'PE32+',machine:'I386'}, {format:'PE32+',machine:'x64'},
    {},null,
  ]){
    assert.equal(status(run({result}),'windows-pe'),'blocked');
  }
});

test('PE read errors are redacted from text and JSON reports',()=>{
  const r=run({inspect:()=>{throw Error('C:\\Users\\Secret\\private.exe');}});
  assert.equal(status(r,'windows-pe'),'blocked');
  assert.doesNotMatch(formatReport(r),/Secret|private\.exe/);
  assert.doesNotMatch(JSON.stringify(r),/Secret|private\.exe/);
});

test('setup/build and other operating systems never inspect a Windows exe',()=>{
  for(const cfg of [
    {stage:'setup',platform:'win32'}, {stage:'build',platform:'win32'},
    {stage:'verify',platform:'linux'}, {stage:'verify',platform:'darwin'},
  ]){
    const r=run({...cfg,inspect:()=>{throw Error('unexpected PE read');}});
    assert.equal(status(r,'windows-pe'),undefined);
  }
});
