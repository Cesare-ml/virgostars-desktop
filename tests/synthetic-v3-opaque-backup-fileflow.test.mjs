// Filesystem flow only. Synthetic opaque bytes are NOT SQLCipher ciphertext.
// The native Rust/SQLCipher test suite separately verifies encrypted reopen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants, copyFileSync, existsSync, fsyncSync, linkSync, lstatSync, mkdtempSync, openSync, closeSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'vs-synthetic-opaque-copy-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const src=join(dir,'source.bin');writeFileSync(src,randomBytes(8192));return {dir,src,dst:join(dir,'copy.bin')};}
function copyClosedOpaqueFixture(source,target,{abort=false,tamper=false}={}){
 const stat=lstatSync(source);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1024||stat.size>16*1024*1024)throw Error('Unsafe source');
 if(['-wal','-shm','-journal'].some(s=>existsSync(source+s)))throw Error('Sidecar present');
 const before=hash(source),temp=join(dirname(target),'.'+basename(target)+'.'+randomUUID()+'.tmp');
 try{
  copyFileSync(source,temp,constants.COPYFILE_EXCL);
  const fd=openSync(temp,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
  if(tamper){const bytes=readFileSync(temp);bytes[256]^=0xff;writeFileSync(temp,bytes);}
  if(hash(temp)!==before)throw Error('Copy mismatch');
  if(abort)throw Error('Synthetic interruption');
  linkSync(temp,target); // same-directory, atomic no-clobber publish
 }finally{if(existsSync(temp))unlinkSync(temp);}
}
test('opaque synthetic file can be copied byte-for-byte without touching source',t=>{const x=fixture(t),before=hash(x.src);copyClosedOpaqueFixture(x.src,x.dst);assert.equal(hash(x.dst),before);assert.equal(hash(x.src),before);});
test('a pre-existing destination is never overwritten',t=>{const x=fixture(t);writeFileSync(x.dst,'pre-existing fictional artifact');assert.throws(()=>copyClosedOpaqueFixture(x.src,x.dst),/EEXIST/);assert.equal(readFileSync(x.dst,'utf8'),'pre-existing fictional artifact');});
test('injected interruption leaves no published backup and removes staging',t=>{const x=fixture(t),before=hash(x.src);assert.throws(()=>copyClosedOpaqueFixture(x.src,x.dst,{abort:true}),/interruption/);assert.equal(existsSync(x.dst),false);assert.deepEqual(readdirSync(x.dir),['source.bin']);assert.equal(hash(x.src),before);});
test('a changed staged copy cannot be published',t=>{const x=fixture(t);assert.throws(()=>copyClosedOpaqueFixture(x.src,x.dst,{tamper:true}),/Copy mismatch/);assert.equal(existsSync(x.dst),false);assert.deepEqual(readdirSync(x.dir),['source.bin']);});
test('a symlinked source is rejected',t=>{const x=fixture(t),alias=join(x.dir,'alias.bin');try{symlinkSync(x.src,alias);}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('OS denies symlink creation');return;}throw error;}assert.throws(()=>copyClosedOpaqueFixture(alias,x.dst),/Unsafe source/);assert.equal(existsSync(x.dst),false);});
test('hot-journal or WAL sidecar blocks copy',t=>{const x=fixture(t);for(const suffix of ['-journal','-wal','-shm']){writeFileSync(x.src+suffix,'fictional sidecar');assert.throws(()=>copyClosedOpaqueFixture(x.src,x.dst),/Sidecar present/);unlinkSync(x.src+suffix);}assert.equal(existsSync(x.dst),false);});
test('a repeated publication attempt cannot replace the first copy',t=>{const x=fixture(t);copyClosedOpaqueFixture(x.src,x.dst);const published=hash(x.dst);assert.throws(()=>copyClosedOpaqueFixture(x.src,x.dst),/EEXIST/);assert.equal(hash(x.dst),published);});
test('absent or undersized source is rejected without destination creation',t=>{const x=fixture(t);assert.throws(()=>copyClosedOpaqueFixture(join(x.dir,'missing.bin'),x.dst),/ENOENT/);writeFileSync(x.src,'short');assert.throws(()=>copyClosedOpaqueFixture(x.src,x.dst),/Unsafe source/);assert.equal(existsSync(x.dst),false);});
