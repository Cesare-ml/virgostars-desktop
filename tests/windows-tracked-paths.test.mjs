import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {checkTrackedPaths,parseTrackedGitPaths,inspectTrackedPaths} from '../scripts/verify-windows-tracked-paths.mjs';

const invalid=[
  'src/CON.ts','src/aux.json','assets/LPT9.txt','assets/com¹.png',
  'src/CONIN$','src/conout$.data','src/where.','src/space ',
  'src/forbidden:stream','src/a\\b','src/broken?','src/bad\u0001.txt',
  '/absolute.txt','src//duplicate','src/../oops','src/.',
  'a/'.concat('n'.repeat(256))
];
for(const path of invalid){
  test('reject nonportable tracked name without echoing it',()=>{
    assert.throws(()=>checkTrackedPaths(['README.md',path]),error=>{
      assert.match(error.message,/WINDOWS TRACKED PATHS:/);
      assert.ok(!error.message.includes(path));return true;
    });
  });
}

test('accept ordinary source paths and Unicode without colliding',()=>{
  assert.deepEqual(checkTrackedPaths(['src/graph.ts','src/Moon/chart.ts','docs/Città.md']),
    {files:3,windowsPortableNames:true});
});

test('reject Windows aliases and file/directory collisions',()=>{
  for(const paths of [
    ['src/Clock.ts','src/clock.ts'],
    ['docs/CITTÀ.md','docs/citta\u0300.md'],
    ['src/Panel/a.ts','src/panel/A.ts'],
    ['src','src/settings.json'],
    ['src/Panel','src/panel/nested.ts'],
    ['identical','identical']
  ])assert.throws(()=>checkTrackedPaths(paths),/WINDOWS TRACKED PATHS:/);
});

test('NUL-delimited Git records reject missing delimiter, malformed UTF-8 and empty entries',()=>{
  assert.deepEqual(parseTrackedGitPaths(Buffer.from('README.md\0src/Panel.ts\0')),
    {files:2,windowsPortableNames:true});
  for(const bytes of [Buffer.alloc(0),Buffer.from('abc'),Buffer.from('a\0\0'),
    Buffer.from([0x62,0x61,0x64,0xff,0]),Buffer.alloc(4*1024*1024+1,65)])
    assert.throws(()=>parseTrackedGitPaths(bytes),/WINDOWS TRACKED PATHS:/);
});

function git(dir,...args){
  const result=spawnSync('git',args,{cwd:dir,encoding:'utf8'});
  assert.equal(result.status,0,'synthetic Git command '+args[0]+' failed');
  return result.stdout.trim();
}

test('full Git fixture leaves HEAD, index and worktree unchanged',t=>{
  const dir=mkdtempSync(join(tmpdir(),'vs-portable-git-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  git(dir,'init','-q','-b','main');
  git(dir,'config','user.name','Synthetic Test');
  git(dir,'config','user.email','test@example.invalid');
  for(const name of ['src/app.ts','docs/Review.md']){
    mkdirSync(dirname(join(dir,name)),{recursive:true});
    writeFileSync(join(dir,name),'synthetic fixture');
  }
  git(dir,'add','.');git(dir,'commit','-qm','synthetic baseline');
  const head=git(dir,'rev-parse','HEAD');
  const before=git(dir,'status','--porcelain');
  assert.deepEqual(inspectTrackedPaths(dir),{files:2,windowsPortableNames:true});
  assert.equal(git(dir,'rev-parse','HEAD'),head);
  assert.equal(git(dir,'status','--porcelain'),before);
});

test('Git fixture detects Windows aliases absent on Linux', {skip:process.platform==='win32'}, t=>{
  const dir=mkdtempSync(join(tmpdir(),'vs-case-git-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  git(dir,'init','-q','-b','main');
  writeFileSync(join(dir,'Clock.ts'),'x');
  writeFileSync(join(dir,'clock.ts'),'x');
  git(dir,'add','.');
  assert.throws(()=>inspectTrackedPaths(dir),/case-insensitive or Unicode duplicate/);
});
