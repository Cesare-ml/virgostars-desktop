import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readBoundedMetadata} from '../scripts/read-bounded-metadata.mjs';

function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'vs-bounded-npm-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'package-lock.json');
  return{dir,file};
}

test('reads exact bytes from regular metadata without changing the file',t=>{
  const {file}=fixture(t);
  const value=Buffer.from('{"name":"synthetic"}\n');
  writeFileSync(file,value);
  assert.deepEqual(readBoundedMetadata(file,1024),value);
});

test('rejects metadata whose size reaches or exceeds the byte cap',t=>{
  const {file}=fixture(t);
  writeFileSync(file,Buffer.alloc(32,65));
  assert.throws(()=>readBoundedMetadata(file,32),/oversized/);
  assert.throws(()=>readBoundedMetadata(file,31),/oversized/);
  assert.deepEqual(readBoundedMetadata(file,33),Buffer.alloc(32,65));
});

test('rejects symlinked files and directory entries', {skip:process.platform==='win32'},t=>{
  const {dir,file}=fixture(t),target=join(dir,'safe.json');
  writeFileSync(target,'{}');
  symlinkSync(target,file);
  assert.throws(()=>readBoundedMetadata(file,100),/Unsafe/);
  rmSync(file);mkdirSync(file);
  assert.throws(()=>readBoundedMetadata(file,100),/Unsafe/);
});

test('rejects malformed byte limits before reading any file',t=>{
  const {file}=fixture(t);
  writeFileSync(file,'{}');
  for(const limit of [0,1,-1,1.5,NaN,Infinity,16*1024*1024+1])
    assert.throws(()=>readBoundedMetadata(file,limit),/Invalid metadata byte limit/);
});

test('reads multi-megabyte JSON without overrun',t=>{
  const {file}=fixture(t);
  const value=Buffer.from(JSON.stringify({items:'x'.repeat(900000)}));
  writeFileSync(file,value);
  assert.deepEqual(readBoundedMetadata(file,1000000),value);
});
