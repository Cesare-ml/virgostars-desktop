import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, symlinkSync, rmSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectWindowsExecutable, validateWindowsPeX64} from '../scripts/verify-windows-executable.mjs';

function fixture({offset=128,machine=0x8664,magic=0x20b,sections=1,
  optionalSize=0xf0,characteristics=0x0022,size=1024}={}) {
  const b=Buffer.alloc(size);
  b.write('MZ',0,'ascii');b.writeUInt32LE(offset,0x3c);
  if (offset+26 <= size) {
    b.write('PE\0\0',offset,'ascii');
    b.writeUInt16LE(machine,offset+4);
    b.writeUInt16LE(sections,offset+6);
    b.writeUInt16LE(optionalSize,offset+20);
    b.writeUInt16LE(characteristics,offset+22);
    b.writeUInt16LE(magic,offset+24);
  }
  return b;
}
function isolated(fn) {
  const dir=mkdtempSync(join(tmpdir(),'vs-pe-fixture-'));
  try {return fn(dir);} finally {rmSync(dir,{recursive:true,force:true});}
}
const decoded=b=>validateWindowsPeX64(b.subarray(0,64),
  b.subarray(b.readUInt32LE(0x3c),b.readUInt32LE(0x3c)+26),b.length);

test('accepts a synthetic PE32+ AMD64 executable using bounded file reads',()=>isolated(dir=>{
  const p=join(dir,'synthetic.exe');writeFileSync(p,fixture());
  assert.deepEqual(inspectWindowsExecutable(p),{format:'PE32+',machine:'AMD64'});
}));
test('validates PE offset, exact signature, executable flag and 64-bit magic',()=>{
  const cases=[
    b=>b.write('NO',0,'ascii'),
    b=>b.writeUInt32LE(63,0x3c),
    b=>b.writeUInt32LE(1048577,0x3c),
    b=>b.write('ELF!',128,'ascii'),
    b=>b.writeUInt16LE(0x14c,128+4),
    b=>b.writeUInt16LE(0x10b,128+24),
    b=>b.writeUInt16LE(0,128+22),
    b=>b.writeUInt16LE(0,128+6),
    b=>b.writeUInt16LE(97,128+6),
    b=>b.writeUInt16LE(2,128+20),
  ];
  for(const change of cases){const b=fixture();change(b);assert.throws(()=>decoded(b));}
});
test('rejects truncated PE region and section table beyond file bounds',()=>{
  assert.throws(()=>decoded(fixture({size:192})));
  assert.throws(()=>decoded(fixture({size:400,sections:5})));
});
test('rejects missing files, empty data and directory placeholders',()=>isolated(dir=>{
  assert.throws(()=>inspectWindowsExecutable(join(dir,'missing.exe')));
  const empty=join(dir,'empty.exe');writeFileSync(empty,Buffer.alloc(0));
  assert.throws(()=>inspectWindowsExecutable(empty));
  const folder=join(dir,'folder.exe');mkdirSync(folder);
  assert.throws(()=>inspectWindowsExecutable(folder));
}));
test('rejects symlink files rather than following them',t=>isolated(dir=>{
  const target=join(dir,'target.exe');writeFileSync(target,fixture());
  const link=join(dir,'link.exe');
  try{symlinkSync(target,link);}catch(err){
    if(['EPERM','EACCES','ENOTSUP'].includes(err.code)){t.skip('Symlink unavailable');return;}
    throw err;
  }
  assert.throws(()=>inspectWindowsExecutable(link));
}));
test('accepts realistic non-default PE header offsets within the bounded range',()=>{
  const b=fixture({offset:1024,size:2048});
  assert.deepEqual(decoded(b),{format:'PE32+',machine:'AMD64'});
});
