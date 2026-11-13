import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectAngularChunkGraph} from '../scripts/verify-angular-chunks.mjs';

function fixture(fn) {
  const dir=mkdtempSync(join(tmpdir(),'vs-chunk-gate-'));
  const main='main-FAKE123.js';
  const add=(name,body)=>writeFileSync(join(dir,name),body);
  add(main,'/* synthetic local module */');
  try { fn({dir,main,add,verify:()=>inspectAngularChunkGraph(dir,[main])}); }
  finally { rmSync(dir,{recursive:true,force:true}); }
}

test('accepts standalone local Angular main module',()=>fixture(f=>{
  assert.deepEqual(f.verify(),{modules:1,chunks:0,dependencies:0});
}));
test('accepts static import of bundled chunk',()=>fixture(f=>{
  f.add(f.main,'import {a} from "./chunk-ABCDE.js"; console.log(a)');
  f.add('chunk-ABCDE.js','export const a=1;');
  assert.deepEqual(f.verify(),{modules:2,chunks:1,dependencies:1});
}));
test('accepts lazy dynamic import and transitive chunk dependency',()=>fixture(f=>{
  f.add(f.main,'const lazy=()=>import("./chunk-LAZY.js");');
  f.add('chunk-LAZY.js','export {a} from "./chunk-BASE.js";');
  f.add('chunk-BASE.js','export const a=1;');
  assert.deepEqual(f.verify(),{modules:3,chunks:2,dependencies:2});
}));
test('accepts side-effect imports and literal template dynamic imports',()=>fixture(f=>{
  f.add(f.main,'import "./chunk-SIDE.js";const f=()=>import(`./chunk-BASE.js`);');
  f.add('chunk-SIDE.js','const a=2;'); f.add('chunk-BASE.js','const b=3;');
  assert.deepEqual(f.verify(),{modules:3,chunks:2,dependencies:2});
}));
test('allows separate optional local polyfills entrypoint',()=>fixture(f=>{
  f.add('polyfills-OK.js','import "./chunk-FILL.js";');
  f.add('chunk-FILL.js','export const polyfill=true;');
  assert.deepEqual(inspectAngularChunkGraph(f.dir,['polyfills-OK.js',f.main]),{modules:3,chunks:1,dependencies:1});
}));
test('a reference to an absent lazy chunk rejects the bundle',()=>fixture(f=>{
  f.add(f.main,'import("./chunk-MISSING.js")');
  assert.throws(f.verify,/Imported Angular JavaScript chunk missing/);
}));
test('transitive missing chunk rejects even if main dependency exists',()=>fixture(f=>{
  f.add(f.main,'import "./chunk-PRESENT.js"');
  f.add('chunk-PRESENT.js','import "./chunk-MISSING.js"');
  assert.throws(f.verify,/Imported Angular JavaScript chunk missing/);
}));
test('re-export dependency cannot point to absent chunk',()=>fixture(f=>{
  f.add(f.main,'export * from "./chunk-LOST.js"');
  assert.throws(f.verify,/Imported Angular JavaScript chunk missing/);
}));
test('orphan chunk is rejected instead of silently bundled',()=>fixture(f=>{
  f.add('chunk-ORPHAN.js','export const x=1;');
  assert.throws(f.verify,/Unreferenced Angular JavaScript chunk/);
}));
test('quotes and comments that look like imports are not executable edges',()=>fixture(f=>{
  f.add(f.main,'/* import("./chunk-ABSENT.js") */;const note=`import("./chunk-FAKE.js")`;');
  assert.deepEqual(f.verify(),{modules:1,chunks:0,dependencies:0});
}));
test('repeated imports and cyclic imports terminate without infinite loop',()=>fixture(f=>{
  f.add(f.main,'import "./chunk-A.js";import "./chunk-A.js";');
  f.add('chunk-A.js','import "./chunk-B.js"');
  f.add('chunk-B.js','import "./chunk-A.js"');
  assert.deepEqual(f.verify(),{modules:3,chunks:2,dependencies:4});
}));
test('rejects remote, absolute, traversal and bare module imports',()=>fixture(f=>{
  for(const src of ['https://invalid.example/x.js','/chunk-ABS.js','../chunk-UP.js','chunk-NO.js','./chunk-OK.js?x=1','./chunk-B.js#hash','data:text/javascript,0']) {
    f.add(f.main,`import(${JSON.stringify(src)})`);
    assert.throws(f.verify,/Nonlocal or invalid JavaScript import|Unexpected JavaScript import filename/,src);
  }
}));
test('rejects computed dynamic imports rather than assuming chunk completeness',()=>fixture(f=>{
  f.add(f.main,'const src="./chunk-HIDDEN.js";const load=()=>import(src);');
  f.add('chunk-HIDDEN.js','export const a=1;');
  assert.throws(f.verify,/Nonliteral dynamic JavaScript import/);
}));
test('rejects template interpolation dynamic imports',()=>fixture(f=>{
  f.add(f.main,'const name="x";import(`./chunk-${name}.js`)');
  assert.throws(f.verify,/Nonliteral dynamic JavaScript import/);
}));
test('rejects malformed JavaScript before packaging',()=>fixture(f=>{
  f.add(f.main,'import { from "./chunk-BAD.js";');
  assert.throws(f.verify,/Invalid emitted JavaScript syntax/);
}));
test('rejects a symlinked chunk even when it resolves to local bytes',()=>fixture(f=>{
  f.add(f.main,'import("./chunk-SYM.js")');
  f.add('chunk-REAL.js','export const a=1;');
  symlinkSync(join(f.dir,'chunk-REAL.js'),join(f.dir,'chunk-SYM.js'));
  assert.throws(f.verify,/Unexpected or unsafe root JavaScript file/);
}));
test('rejects unrelated root JS scripts even if their contents appear harmless',()=>fixture(f=>{
  f.add('debug.js','console.log("fictional")');
  assert.throws(f.verify,/Unexpected or unsafe root JavaScript file/);
}));
test('rejects invalid, duplicate, empty and oversized entrypoint lists',()=>fixture(f=>{
  for(const entries of [[],[f.main,f.main],['../../x.js'],['http://x'],[f.main,'polyfills.js','chunk-EXTRA.js']]) {
    assert.throws(()=>inspectAngularChunkGraph(f.dir,entries),/Invalid Angular module entrypoint list/);
  }
}));
