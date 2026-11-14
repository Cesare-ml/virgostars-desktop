import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {safeRef,parsePaths,parseCommitDrift,report,parseArgs,run} from '../scripts/branch-overlap-report.mjs';

const script=resolve(import.meta.dirname,'../scripts/branch-overlap-report.mjs');
function git(dir,...args) {
  const r=spawnSync('git',args,{cwd:dir,encoding:'utf8'});
  assert.equal(r.status,0,`synthetic git ${args[0]} failed`);
  return r.stdout.trim();
}

test('safe refs and arguments reject ambiguous revisions',()=>{
  for (const x of ['main','origin/fix-city','fix/dev.2']) assert.equal(safeRef(x),true);
  for (const x of ['-a','../main','a//b','a/.dot','a.lock','a@{1}','a b']) assert.equal(safeRef(x),false);
  assert.deepEqual(parseArgs(['--base=main','a','b','--json']),{base:'main',branches:['a','b'],json:true});
  for (const args of [['a'],['a','a'],['a','main'],['--base=main','--base=main','a','b']])
    assert.throws(()=>parseArgs(args));
  assert.throws(()=>run('--evil',['a','b']),/Invalid|Provide/);
  assert.throws(()=>run('main',['same','same']),/Invalid|Provide/);
});

test('revision counters accept only complete finite Git left/right counts',()=>{
  assert.deepEqual(parseCommitDrift(Buffer.from('2\t3\n')),{behindBy:2,aheadBy:3});
  assert.deepEqual(parseCommitDrift(Buffer.from('0\t0\n')),{behindBy:0,aheadBy:0});
  for (const invalid of ['','1 2','-1\t2','1\t2\t3','1\tNaN','9007199254740992\t1',
    '1\t2\nprivate', '1\t2\r\nextra']) {
    assert.throws(()=>parseCommitDrift(Buffer.from(invalid)), 'must reject invalid revision counter');
  }
  assert.throws(()=>parseCommitDrift('0\t0'));
  assert.throws(()=>parseCommitDrift(Buffer.alloc(65,0x30)));
  assert.throws(()=>report('main',[
    {branch:'a',paths:['x'],behindBy:0,aheadBy:1},
    {branch:'b',paths:['x']}]), /Incomplete Git revision counts/);
});

test('base-side overlap requires complete reports and never claims merge safety',()=>{
  const reportWithMain = report('main',[
    {branch:'b',paths:['shared','only-b'],behindBy:2,aheadBy:1,baseSidePaths:['shared','shared','base-only']},
    {branch:'a',paths:['shared','only-a'],behindBy:0,aheadBy:1,baseSidePaths:[]},
  ]);
  assert.equal(reportWithMain.baseFilesChecked,true);
  assert.equal(reportWithMain.baseOverlapFiles,1);
  assert.deepEqual(reportWithMain.baseOverlaps,[{branch:'b',path:'shared'}]);
  assert.equal(reportWithMain.overlapFiles,1);
  assert.deepEqual(reportWithMain.staleBranches,['b']);
  assert.match(reportWithMain.note,/review/);
  assert.throws(()=>report('main',[
    {branch:'a',paths:['shared'],behindBy:1,aheadBy:1,baseSidePaths:['shared']},
    {branch:'b',paths:['other'],behindBy:1,aheadBy:1},
  ]),/Incomplete base-side file comparison/);
  assert.throws(()=>report('main',[
    {branch:'a',paths:['shared'],behindBy:1,aheadBy:1,baseSidePaths:['\0']},
    {branch:'b',paths:[],behindBy:0,aheadBy:1,baseSidePaths:[]},
  ]),/Invalid base-side path/);
  const withoutAudit=report('main',[{branch:'a',paths:[]},{branch:'b',paths:[]}]);
  assert.equal(withoutAudit.baseFilesChecked,false);
  assert.deepEqual(withoutAudit.baseOverlaps,[]);
});

test('NUL-safe file parser and deterministic path overlaps',()=>{
  const names=['src/a b.ts','docs/città.md','src/new\nline.ts'];
  assert.deepEqual(parsePaths(Buffer.from(['M',names[0],'A',names[1],'D',names[2]].join('\0')+'\0')),names);
  assert.throws(()=>parsePaths(Buffer.from('not terminated')));
  assert.throws(()=>parsePaths(Buffer.from([0xc3,0x28,0])));
  assert.deepEqual(parsePaths(Buffer.from('R100\0old name\0new name\0M\0other\0')),['old name','new name','other']);
  assert.deepEqual(parsePaths(Buffer.from('C75\0old\0copy\0')),['old','copy']);
  for (const malformed of ['R100\0old\0','M\0','X\0path\0','R101\0a\0b\0','M\0path\0R100\0a\0']) {
    assert.throws(()=>parsePaths(Buffer.from(malformed)), malformed);
  }
  const result=report('main',[{branch:'a',paths:['same','only-a','same']},
    {branch:'b',paths:['same','only-b']},{branch:'c',paths:['only-c']}]);
  assert.deepEqual(result.overlaps,[{path:'same',branches:['a','b']}]);
  assert.deepEqual(result.branches.map(x=>x.changedFiles),[2,2,1]);
});

test('end to end: local Git reports overlap without changing branch or tree',t=>{
  const dir=mkdtempSync(join(tmpdir(),'vs-branch-audit-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  git(dir,'init','-q','-b','main');
  git(dir,'config','user.email','test@example.invalid');
  git(dir,'config','user.name','Synthetic Test');
  writeFileSync(join(dir,'common'),'base\n');
  git(dir,'add','.');git(dir,'commit','-qm','base');
  git(dir,'branch','a');git(dir,'branch','b');
  git(dir,'switch','-q','a');writeFileSync(join(dir,'common'),'a\n');
  git(dir,'add','.');git(dir,'commit','-qm','a');
  git(dir,'switch','-q','b');writeFileSync(join(dir,'common'),'b\n');
  git(dir,'add','.');git(dir,'commit','-qm','b');
  const head=git(dir,'rev-parse','HEAD');
  const r=spawnSync(process.execPath,[script,'--json','a','b'],{cwd:dir,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).overlaps,[{path:'common',branches:['a','b']}]);
  assert.equal(git(dir,'rev-parse','HEAD'),head);
  assert.equal(git(dir,'branch','--show-current'),'b');
  assert.equal(git(dir,'status','--porcelain'),'');
  const bad=spawnSync(process.execPath,[script,'a','missing'],{cwd:dir,encoding:'utf8'});
  assert.equal(bad.status,2);
  assert.ok(!bad.stderr.includes(dir),'do not reveal local absolute paths');
});

test('end to end: rename source and destination both reveal concurrent path overlaps',t=>{
  const dir=mkdtempSync(join(tmpdir(),'vs-rename-audit-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  git(dir,'init','-q','-b','main');
  git(dir,'config','user.email','test@example.invalid');
  git(dir,'config','user.name','Synthetic Test');
  writeFileSync(join(dir,'old città name.txt'),'A fictional file with several distinct words.\n');
  git(dir,'add','.'); git(dir,'commit','-qm','base');
  git(dir,'branch','rename'); git(dir,'branch','edit');
  git(dir,'switch','-q','rename'); git(dir,'mv','old città name.txt','new città name.txt');
  git(dir,'commit','-qm','rename');
  git(dir,'switch','-q','edit');
  writeFileSync(join(dir,'old città name.txt'),'Another fictional change to the original file.\n');
  git(dir,'add','.'); git(dir,'commit','-qm','edit');
  const head=git(dir,'rev-parse','HEAD');
  const r=spawnSync(process.execPath,[script,'--json','rename','edit'],{cwd:dir,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  const result=JSON.parse(r.stdout);
  assert.deepEqual(result.overlaps,[{path:'old città name.txt',branches:['edit','rename']}]);
  assert.deepEqual(result.branches.map(x=>x.changedFiles),[2,1], 'rename counts source and destination paths');
  assert.equal(git(dir,'rev-parse','HEAD'),head);
  assert.equal(git(dir,'branch','--show-current'),'edit');
  assert.equal(git(dir,'status','--porcelain'),'');
});

test('end to end: reports branch divergence when main advances without modifying working tree',t=>{
  const dir=mkdtempSync(join(tmpdir(),'vs-drift-audit-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  git(dir,'init','-q','-b','main');
  git(dir,'config','user.email','test@example.invalid');
  git(dir,'config','user.name','Synthetic Test');
  writeFileSync(join(dir,'base.txt'),'fictional base\n');
  git(dir,'add','.');git(dir,'commit','-qm','base');
  git(dir,'branch','a');git(dir,'branch','b');
  git(dir,'switch','-q','a');writeFileSync(join(dir,'a.txt'),'fictional a\n');
  git(dir,'add','.');git(dir,'commit','-qm','a');
  git(dir,'switch','-q','b');writeFileSync(join(dir,'b.txt'),'fictional b\n');
  git(dir,'add','.');git(dir,'commit','-qm','b');
  git(dir,'switch','-q','main');writeFileSync(join(dir,'new.txt'),'fictional main\n');
  git(dir,'add','.');git(dir,'commit','-qm','new main');
  const head=git(dir,'rev-parse','HEAD');
  const r=spawnSync(process.execPath,[script,'--json','a','b'],{cwd:dir,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  const data=JSON.parse(r.stdout);
  assert.equal(data.freshnessChecked,true);
  assert.deepEqual(data.staleBranches,['a','b']);
  assert.deepEqual(data.branches.map(b=>[b.behindBy,b.aheadBy]),[[1,1],[1,1]]);
  assert.equal(git(dir,'rev-parse','HEAD'),head);
  assert.equal(git(dir,'branch','--show-current'),'main');
  assert.equal(git(dir,'status','--porcelain'),'');
});

test('end to end: identifies files changed on main and a feature branch since divergence',t=>{
  const dir=mkdtempSync(join(tmpdir(),'vs-main-overlap-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  git(dir,'init','-q','-b','main');
  git(dir,'config','user.email','test@example.invalid');
  git(dir,'config','user.name','Synthetic Test');
  writeFileSync(join(dir,'common.txt'),'Synthetic original\n');
  git(dir,'add','.');git(dir,'commit','-qm','base');
  git(dir,'branch','a');git(dir,'branch','b');
  git(dir,'switch','-q','a');
  writeFileSync(join(dir,'common.txt'),'Synthetic branch change\n');
  git(dir,'add','.');git(dir,'commit','-qm','a change');
  git(dir,'switch','-q','b');
  writeFileSync(join(dir,'b.txt'),'Synthetic separate change\n');
  git(dir,'add','.');git(dir,'commit','-qm','b change');
  git(dir,'switch','-q','main');
  writeFileSync(join(dir,'common.txt'),'Synthetic main change\n');
  git(dir,'add','.');git(dir,'commit','-qm','main change');
  const head=git(dir,'rev-parse','HEAD');
  const result=spawnSync(process.execPath,[script,'--json','a','b'],{cwd:dir,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const data=JSON.parse(result.stdout);
  assert.equal(data.freshnessChecked,true);
  assert.equal(data.baseFilesChecked,true);
  assert.equal(data.overlapFiles,0,'feature branches do not share modified paths');
  assert.equal(data.baseOverlapFiles,1,'but main and branch a both modified common.txt');
  assert.deepEqual(data.baseOverlaps,[{branch:'a',path:'common.txt'}]);
  assert.deepEqual(data.branches.map(x=>[x.behindBy,x.aheadBy]),[[1,1],[1,1]]);
  assert.equal(git(dir,'rev-parse','HEAD'),head);
  assert.equal(git(dir,'status','--porcelain'),'');
  assert.equal(git(dir,'branch','--show-current'),'main');
});
