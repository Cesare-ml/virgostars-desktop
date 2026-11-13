import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {auditBuildPrivacy} from '../scripts/verify-build-privacy.mjs';

function fixture(run) {
  const root=mkdtempSync(join(tmpdir(),'vs-privacy-utf8-'));
  const bundle=join(root,'browser');
  const add=(path,content='fictional')=>{
    const absolute=join(bundle,path);
    mkdirSync(dirname(absolute),{recursive:true});
    writeFileSync(absolute,content);
  };
  add('index.html','<html><vs-desktop-app></vs-desktop-app></html>');
  add('main-LCL123.js','/* synthetic JS module */');
  add('styles-LOCAL.css','*{box-sizing:border-box}vs-desktop-app{display:block}');
  add('assets/img/a.png','fake image bytes');
  try{return run({root,bundle,add});}finally{rmSync(root,{recursive:true,force:true})}
}

test('rejects invalid UTF-8 in root HTML',()=>fixture(f=>{
  f.add('index.html',Buffer.from([0x3c,0x76,0x73,0xff,0x3e]));
  assert.throws(()=>auditBuildPrivacy(f.bundle),/invalid UTF-8 in browser HTML or code asset/);
}));
test('rejects invalid UTF-8 in main JavaScript',()=>fixture(f=>{
  f.add('main-LCL123.js',Buffer.from([0x2f,0x2a,0xff,0x2a,0x2f]));
  assert.throws(()=>auditBuildPrivacy(f.bundle),/invalid UTF-8 in browser HTML or code asset/);
}));
test('rejects invalid UTF-8 in stylesheet',()=>fixture(f=>{
  f.add('styles-LOCAL.css',Buffer.from([0x7b,0xc3,0x28,0x7d]));
  assert.throws(()=>auditBuildPrivacy(f.bundle),/invalid UTF-8 in browser HTML or code asset/);
}));
test('rejects NUL byte in HTML',()=>fixture(f=>{
  f.add('index.html','<html>\0</html>');
  assert.throws(()=>auditBuildPrivacy(f.bundle),/NUL character in browser HTML or code asset/);
}));
test('rejects NUL byte in JavaScript',()=>fixture(f=>{
  f.add('main-LCL123.js','/* synthetic */\0');
  assert.throws(()=>auditBuildPrivacy(f.bundle),/NUL character in browser HTML or code asset/);
}));
test('rejects NUL byte in CSS',()=>fixture(f=>{
  f.add('styles-LOCAL.css','body{}\0');
  assert.throws(()=>auditBuildPrivacy(f.bundle),/NUL character in browser HTML or code asset/);
}));
test('accepts valid non-ASCII UTF-8 in generated JavaScript',()=>fixture(f=>{
  f.add('main-LCL123.js','const translation = "Città · città";');
  assert.deepEqual(auditBuildPrivacy(f.bundle),{files:4,sourceFiles:2});
}));
test('accepts valid non-ASCII UTF-8 in HTML and CSS',()=>fixture(f=>{
  f.add('index.html','<html lang="it"><title>Città · città</title></html>');
  f.add('styles-LOCAL.css','/* Città */ vs-desktop-app{display:block}');
  assert.deepEqual(auditBuildPrivacy(f.bundle),{files:4,sourceFiles:2});
}));
