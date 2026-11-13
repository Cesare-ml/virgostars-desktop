import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat, symlink, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  recordNewDirectory, recordCreatedFile, cleanupOnlyOwnedFiles,
} from '../scripts/ephemeris/rollback-horizons-directory.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(),'vs-horizons-rollback-'));
  const dir = join(root,'new');
  await mkdir(dir);
  const identity = await recordNewDirectory(dir);
  try { await run({root,dir,identity}); }
  finally { await rm(root,{recursive:true,force:true}); }
}
async function own(dir,name='horizons-sun.txt',content='fictional') {
  await writeFile(join(dir,name),content,{flag:'wx'});
  return recordCreatedFile(dir,name);
}

test('empty newly created output directory may be removed safely',async()=>fixture(async({dir,identity})=>{
  assert.equal(await cleanupOnlyOwnedFiles(dir,identity,[]),true);
  await assert.rejects(stat(dir),{code:'ENOENT'});
}));
test('only exact newly created files are removed',async()=>fixture(async({dir,identity})=>{
  const a=await own(dir),b=await own(dir,'response-manifest.json','{}');
  assert.equal(await cleanupOnlyOwnedFiles(dir,identity,[a,b]),true);
  await assert.rejects(stat(dir),{code:'ENOENT'});
}));
test('unexpected file preserves the whole folder and all artifacts',async()=>fixture(async({dir,identity})=>{
  const a=await own(dir);
  await writeFile(join(dir,'important-user-file.txt'),'KEEP');
  assert.equal(await cleanupOnlyOwnedFiles(dir,identity,[a]),false);
  assert.equal(await readFile(join(dir,'important-user-file.txt'),'utf8'),'KEEP');
  assert.equal(await readFile(join(dir,'horizons-sun.txt'),'utf8'),'fictional');
}));
test('changed owned file metadata means no deletion of user edits',async()=>fixture(async({dir,identity})=>{
  const a=await own(dir);
  await writeFile(join(dir,a.name),'different content');
  assert.equal(await cleanupOnlyOwnedFiles(dir,identity,[a]),false);
  assert.equal(await readFile(join(dir,a.name),'utf8'),'different content');
}));
test('replacing an owned file with a different inode is refused',async()=>fixture(async({dir,identity})=>{
  const a=await own(dir);
  await rm(join(dir,a.name));
  await writeFile(join(dir,a.name),'replacement');
  assert.equal(await cleanupOnlyOwnedFiles(dir,identity,[a]),false);
  assert.equal(await readFile(join(dir,a.name),'utf8'),'replacement');
}));
test('replacing owned file with a symlink is refused',async()=>fixture(async({root,dir,identity})=>{
  const a=await own(dir);
  await rm(join(dir,a.name));
  const target=join(root,'safe.txt');await writeFile(target,'IMPORTANT');
  await symlink(target,join(dir,a.name));
  assert.equal(await cleanupOnlyOwnedFiles(dir,identity,[a]),false);
  assert.equal(await readFile(target,'utf8'),'IMPORTANT');
}));
test('replacing output directory with another directory never removes the substitute',async()=>fixture(async({root,dir,identity})=>{
  const moved=join(root,'moved');await rename(dir,moved);
  await mkdir(dir);await writeFile(join(dir,'critical.txt'),'KEEP');
  assert.equal(await cleanupOnlyOwnedFiles(dir,identity,[]),false);
  assert.equal(await readFile(join(dir,'critical.txt'),'utf8'),'KEEP');
}));
test('symlinked output directory is refused',async()=>fixture(async({root,dir,identity})=>{
  const link=join(root,'linked');await symlink(dir,link);
  assert.equal(await cleanupOnlyOwnedFiles(link,identity,[]),false);
  assert.equal((await lstat(dir)).isDirectory(),true);
}));
test('untracked response file is not deleted even if its filename looks owned',async()=>fixture(async({dir,identity})=>{
  const a=await own(dir);
  await writeFile(join(dir,'horizons-moon.txt'),'UNTRACKED');
  assert.equal(await cleanupOnlyOwnedFiles(dir,identity,[a]),false);
  assert.equal(await readFile(join(dir,'horizons-moon.txt'),'utf8'),'UNTRACKED');
}));
test('no traversal or unexpected output names can be owned',async()=>fixture(async({root,dir,identity})=>{
  for(const name of ['../outside','/absolute','response-manifest.json/../file','horizons-foo.json','x']){
    await assert.rejects(recordCreatedFile(dir,name),/UNSAFE_OUTPUT_FILENAME/);
  }
  assert.equal(await cleanupOnlyOwnedFiles(dir,identity,[{name:'../outside'}]),false);
}));
test('duplicate tracked entries never delete any data',async()=>fixture(async({dir,identity})=>{
  const a=await own(dir);
  assert.equal(await cleanupOnlyOwnedFiles(dir,identity,[a,a]),false);
  assert.equal(await readFile(join(dir,a.name),'utf8'),'fictional');
}));
test('missing recorded file leaves acquisition directory intact',async()=>fixture(async({dir,identity})=>{
  const a=await own(dir);
  await rm(join(dir,a.name));
  assert.equal(await cleanupOnlyOwnedFiles(dir,identity,[a]),false);
  assert.equal((await stat(dir)).isDirectory(),true);
}));
test('invalid directory identity is never accepted',async()=>fixture(async({dir})=>{
  const a=await own(dir);
  assert.equal(await cleanupOnlyOwnedFiles(dir,null,[a]),false);
  assert.equal(await readFile(join(dir,a.name),'utf8'),'fictional');
}));
test('metadata capture refuses arbitrary directory names or symlinks',async()=>fixture(async({root,dir})=>{
  await assert.rejects(recordCreatedFile(dir,'bad.txt'),/UNSAFE_OUTPUT_FILENAME/);
  const outside=join(root,'outside.txt');await writeFile(outside,'hi');
  await symlink(outside,join(dir,'horizons-sun.txt'));
  await assert.rejects(recordCreatedFile(dir,'horizons-sun.txt'),/UNSAFE_OUTPUT_FILE/);
}));
