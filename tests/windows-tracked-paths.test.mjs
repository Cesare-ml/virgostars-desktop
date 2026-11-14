import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {checkTrackedPaths,parseTrackedGitPaths,inspectTrackedPaths,inspectCommitPaths} from '../scripts/verify-windows-tracked-paths.mjs';

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

test('Windows bootstrap checks tracked paths before doctor or dependency installation',()=>{
  const ps1=readFileSync(new URL('../scripts/build-windows-spike.ps1',import.meta.url),'utf8');
  const steps=[...ps1.matchAll(/Invoke-Step\s+'([^']+)'\s+'([^']+)'\s+@\(([^)]*)\)/g)]
    .map(([match,label,command,args])=>({match,label,command,args}));
  const pathGate=steps.findIndex(x=>x.command==='node' &&
    x.args==="'scripts/verify-windows-tracked-paths.mjs'");
  const setup=steps.findIndex(x=>x.command==='node' &&
    x.args==="'scripts/desktop-doctor.mjs', '--stage=setup', '--strict'");
  const installs=steps.map((step,i)=>step.command==='npm.cmd' && step.args==="'ci'"?i:-1)
    .filter(i=>i!==-1);
  assert.ok(pathGate>=0 && setup>pathGate && installs.length===2 &&
    installs.every(i=>i>pathGate),'tracked path check must run before setup and installs');
  assert.equal(steps.filter(x=>x.args==="'scripts/verify-windows-tracked-paths.mjs'").length,1);
  assert.match(ps1,/if \(\$LASTEXITCODE -ne 0\) \{\s*throw /,
    'Windows bootstrap must stop on any failed preflight');
});

test('the regular CMD launcher still delegates only to the checked PowerShell bootstrap',()=>{
  const cmd=readFileSync(new URL('../scripts/build-windows.cmd',import.meta.url),'utf8');
  assert.match(cmd,/"%VS_SYSTEM_POWERSHELL%" -NoProfile -NonInteractive -File "%~dp0build-windows-spike\.ps1"/);
  assert.doesNotMatch(cmd,/verify-windows-tracked-paths|npm\.cmd|cargo|tauri/i);
});

test('commit mode checks an exact local commit without switching branches',t=>{
  const dir=mkdtempSync(join(tmpdir(),'vs-commit-git-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  git(dir,'init','-q','-b','main');
  git(dir,'config','user.name','Synthetic Test');
  git(dir,'config','user.email','test@example.invalid');
  writeFileSync(join(dir,'safe.txt'),'synthetic safe fixture');
  git(dir,'add','.');git(dir,'commit','-qm','synthetic safe');
  const safe=git(dir,'rev-parse','HEAD');
  assert.deepEqual(inspectCommitPaths(dir,safe),{files:1,windowsPortableNames:true});
  git(dir,'branch','unsafe');
  git(dir,'switch','-q','unsafe');
  writeFileSync(join(dir,'CON.txt'),'synthetic Windows-incompatible filename');
  git(dir,'add','.');git(dir,'commit','-qm','synthetic incompatible');
  const unsafe=git(dir,'rev-parse','HEAD');
  git(dir,'switch','-q','main');
  const beforeStatus=git(dir,'status','--porcelain');
  assert.throws(()=>inspectCommitPaths(dir,unsafe),/nonportable Windows path component/);
  assert.deepEqual(inspectCommitPaths(dir,safe),{files:1,windowsPortableNames:true});
  assert.deepEqual(inspectTrackedPaths(dir),{files:1,windowsPortableNames:true});
  assert.equal(git(dir,'rev-parse','HEAD'),safe);
  assert.equal(git(dir,'status','--porcelain'),beforeStatus);
});

test('commit mode rejects incomplete IDs, ambiguous refs and non-commit objects',t=>{
  const dir=mkdtempSync(join(tmpdir(),'vs-commit-id-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  git(dir,'init','-q','-b','main');
  writeFileSync(join(dir,'test.txt'),'synthetic fixture');
  const blob=git(dir,'hash-object','-w','test.txt');
  for(const input of ['HEAD','--help','0'.repeat(39),'0'.repeat(65),'a'.repeat(40)+';exit',null]){
    assert.throws(()=>inspectCommitPaths(dir,input),/invalid full Git commit id/);
  }
  assert.throws(()=>inspectCommitPaths(dir,blob),/local Git commit unavailable/);
  assert.throws(()=>inspectCommitPaths(dir,'0'.repeat(40)),/local Git commit unavailable/);
});

test('CLI commit mode is read-only and fails closed on invalid arguments',t=>{
  const dir=mkdtempSync(join(tmpdir(),'vs-commit-cli-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  git(dir,'init','-q','-b','main');
  git(dir,'config','user.name','Synthetic Test');
  git(dir,'config','user.email','test@example.invalid');
  mkdirSync(join(dir,'scripts'));
  const script=join(dir,'scripts','verify-windows-tracked-paths.mjs');
  copyFileSync(new URL('../scripts/verify-windows-tracked-paths.mjs',import.meta.url),script);
  git(dir,'add','.');git(dir,'commit','-qm','synthetic baseline');
  const commit=git(dir,'rev-parse','HEAD');
  const before=git(dir,'status','--porcelain');
  const invoke=(...args)=>spawnSync(process.execPath,[script,...args],{
    cwd:dir,encoding:'utf8'});
  const success=invoke('--commit='+commit);
  assert.equal(success.status,0,success.stderr);
  assert.match(success.stdout,/1 tracked filenames checked/);
  for(const args of [['--commit=HEAD'],['--commit='+commit,'--unknown'],['--commit='+'0'.repeat(40)]]){
    const fail=invoke(...args);
    assert.equal(fail.status,1);
    assert.equal(fail.stdout,'');
    assert.match(fail.stderr,/WINDOWS TRACKED PATHS:/);
    assert.ok(!fail.stderr.includes('0'.repeat(40)));
  }
  assert.equal(git(dir,'rev-parse','HEAD'),commit);
  assert.equal(git(dir,'status','--porcelain'),before);
});


test('both pre-install audits coexist in reconciled Windows bootstrap',()=>{
  const ps1=readFileSync(new URL('../scripts/build-windows-spike.ps1',import.meta.url),'utf8');
  const steps=[...ps1.matchAll(/Invoke-Step\s+'([^']+)'\s+'([^']+)'\s+@\(([^)]*)\)/g)]
    .map(([,label,command,args])=>({label,command,args}));
  const names=[
    'scripts/verify-windows-tracked-paths.mjs',
    'scripts/desktop-doctor.mjs',
    'scripts/verify-npm-lock.mjs',
    'scripts/verify-charts-npm-lock.mjs',
    'scripts/verify-desktop-version.mjs',
  ];
  const indexes=names.map(p=>steps.findIndex(x=>x.command==='node' && x.args.includes("'"+p+"'")));
  assert.ok(indexes.every((x,i)=>x>=0 && (i===0||x>indexes[i-1])),
    'portable names, doctor and both npm provenance checks must run in order');
  assert.ok(indexes.every((x,i)=>steps.filter(y=>y.args.includes("'"+names[i]+"'")).length===1));
  const installs=steps.map((x,i)=>x.command==='npm.cmd' && x.args==="'ci'"?i:-1).filter(i=>i>=0);
  assert.equal(installs.length,2);
  assert.ok(installs.every(index=>index>indexes.at(-1)));
  assert.match(ps1,/if \(\$LASTEXITCODE -ne 0\) \{\s*throw /,
    'a failed preflight must stop the bootstrap');
});
