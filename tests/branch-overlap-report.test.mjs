import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {safeRef,parsePaths,report,parseArgs} from '../scripts/branch-overlap-report.mjs';

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
});

test('NUL-safe file parser and deterministic path overlaps',()=>{
  const names=['src/a b.ts','docs/città.md','src/new\nline.ts'];
  assert.deepEqual(parsePaths(Buffer.from(names.join('\0')+'\0')),names);
  assert.throws(()=>parsePaths(Buffer.from('not terminated')));
  assert.throws(()=>parsePaths(Buffer.from([0xc3,0x28,0])));
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
