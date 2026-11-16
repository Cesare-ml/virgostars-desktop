import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,lstat,stat,symlink,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {recordNewDirectory,writeOwnedFileOnce,cleanupOnlyOwnedFiles}
  from '../scripts/ephemeris/rollback-horizons-directory.mjs';

async function fixture(run){
  const root=await mkdtemp(join(tmpdir(),'vs-horizons-owned-'));
  const directory=join(root,'new');await mkdir(directory);
  const identity=await recordNewDirectory(directory);
  try {await run({root,directory,identity})} finally {await rm(root,{recursive:true,force:true})}
}

test('descriptor-owned response retains exact bytes and can be removed on failed capture',async()=>fixture(async({directory,identity})=>{
  const bytes=Buffer.from('fictional raw data\r\n','utf8');
  const owned=await writeOwnedFileOnce(directory,identity,'horizons-sun.txt',bytes);
  const onDisk=await lstat(join(directory,'horizons-sun.txt'),{bigint:true});
  assert.equal(owned.ino,onDisk.ino);assert.equal(owned.dev,onDisk.dev);
  assert.equal(owned.size,BigInt(bytes.length));
  assert.deepEqual(await readFile(join(directory,'horizons-sun.txt')),bytes);
  assert.equal(await cleanupOnlyOwnedFiles(directory,identity,[owned]),true);
  await assert.rejects(stat(directory),{code:'ENOENT'});
}));
test('manifest exclusive create uses its own file handle and cleans up safely',async()=>fixture(async({directory,identity})=>{
  const owned=await writeOwnedFileOnce(directory,identity,'response-manifest.json','{"synthetic":true}\n');
  assert.equal(owned.name,'response-manifest.json');
  assert.equal(await cleanupOnlyOwnedFiles(directory,identity,[owned]),true);
}));
test('existing destination is never overwritten or registered as owned',async()=>fixture(async({directory,identity})=>{
  const path=join(directory,'horizons-sun.txt');await writeFile(path,'KEEP');
  await assert.rejects(writeOwnedFileOnce(directory,identity,'horizons-sun.txt','NEW'),{code:'EEXIST'});
  assert.equal(await readFile(path,'utf8'),'KEEP');
}));
test('pre-existing symlink to a foreign file is never overwritten',async()=>fixture(async({root,directory,identity})=>{
  const other=join(root,'private.txt');await writeFile(other,'PRIVATE');
  await symlink(other,join(directory,'horizons-sun.txt'));
  await assert.rejects(writeOwnedFileOnce(directory,identity,'horizons-sun.txt','NEW'));
  assert.equal(await readFile(other,'utf8'),'PRIVATE');
}));
test('unsafe filenames are rejected before file creation',async()=>fixture(async({directory,identity})=>{
  for(const name of ['../outside.txt','/absolute.txt','horizons-foo.json','x','horizons-foo.txt/../../private'])
    await assert.rejects(writeOwnedFileOnce(directory,identity,name,'raw'),/UNSAFE_OUTPUT_FILENAME/);
  assert.deepEqual(await (await import('node:fs/promises')).readdir(directory),[]);
}));
test('empty, oversized or nonbyte content is rejected',async()=>fixture(async({directory,identity})=>{
  await assert.rejects(writeOwnedFileOnce(directory,identity,'horizons-sun.txt',''),/UNSAFE_OUTPUT_CONTENT/);
  await assert.rejects(writeOwnedFileOnce(directory,identity,'horizons-sun.txt',Buffer.alloc(512*1024+1)),/UNSAFE_OUTPUT_CONTENT/);
  await assert.rejects(writeOwnedFileOnce(directory,identity,'response-manifest.json',Buffer.alloc(64*1024+1)),/UNSAFE_OUTPUT_CONTENT/);
  await assert.rejects(writeOwnedFileOnce(directory,identity,'horizons-sun.txt',{raw:'fake'}),/UNSAFE_OUTPUT_CONTENT/);
}));
test('replaced output folder cannot receive a file with stale directory ownership',async()=>fixture(async({root,directory,identity})=>{
  await rename(directory,join(root,'moved'));
  await mkdir(directory);
  await writeFile(join(directory,'private.txt'),'KEEP');
  await assert.rejects(writeOwnedFileOnce(directory,identity,'horizons-sun.txt','NEW'),/UNSAFE_OUTPUT_DIRECTORY/);
  assert.equal(await readFile(join(directory,'private.txt'),'utf8'),'KEEP');
}));
test('substituted response after descriptor capture is not deleted during cleanup',async()=>fixture(async({directory,identity})=>{
  const owned=await writeOwnedFileOnce(directory,identity,'horizons-sun.txt','ORIGINAL');
  await rm(join(directory,'horizons-sun.txt'));
  await writeFile(join(directory,'horizons-sun.txt'),'FOREIGN');
  assert.equal(await cleanupOnlyOwnedFiles(directory,identity,[owned]),false);
  assert.equal(await readFile(join(directory,'horizons-sun.txt'),'utf8'),'FOREIGN');
}));
test('new response is private mode 0600 where POSIX supports chmod modes',async()=>fixture(async({directory,identity})=>{
  const owned=await writeOwnedFileOnce(directory,identity,'horizons-sun.txt','SYNTHETIC');
  const st=await stat(join(directory,'horizons-sun.txt'));
  if(process.platform!=='win32')assert.equal(st.mode&0o777,0o600);
  assert.equal(await cleanupOnlyOwnedFiles(directory,identity,[owned]),true);
}));


test('only the ten canonical plan-owned response basenames can be written',async()=>fixture(async({directory,identity})=>{
  for(const name of ['horizons-foo.txt','horizons-___ .txt','horizons-earth.txt',
    'horizons-sun_extra.txt','horizons-mars.txt','horizons-pluto.txt']) {
    await assert.rejects(writeOwnedFileOnce(directory,identity,name,'fictional'),
      /UNSAFE_OUTPUT_FILENAME/);
  }
  assert.deepEqual(await (await import('node:fs/promises')).readdir(directory),[]);
  const owned=await writeOwnedFileOnce(directory,identity,'horizons-jupiter_barycenter.txt','fictional');
  assert.equal(owned.name,'horizons-jupiter_barycenter.txt');
  assert.equal(await cleanupOnlyOwnedFiles(directory,identity,[owned]),true);
}));

test('unknown horizons-style entry is treated as foreign and prevents cleanup',async()=>fixture(async({directory,identity})=>{
  const owned=await writeOwnedFileOnce(directory,identity,'horizons-sun.txt','official-style synthetic');
  await writeFile(join(directory,'horizons-unknown.txt'),'PRIVATE FOREIGN DATA');
  assert.equal(await cleanupOnlyOwnedFiles(directory,identity,[owned]),false);
  assert.equal(await readFile(join(directory,'horizons-unknown.txt'),'utf8'),'PRIVATE FOREIGN DATA');
  assert.equal(await readFile(join(directory,owned.name),'utf8'),'official-style synthetic');
}));
