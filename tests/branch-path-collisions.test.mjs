import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {findBranchPrefixOverlaps, findBasePrefixOverlaps, MAX_PREFIX_COLLISION_PAIRS} from '../scripts/branch-path-collisions.mjs';

test('detects cross-branch file-versus-directory candidates missed by exact matching', () => {
  const files = new Map([
    ['conf', ['branch-a']], ['conf/places.json', ['branch-b']],
    ['conf/deeper/time.json', ['branch-c']], ['docs/readme.md', ['branch-a', 'branch-b']],
  ]);
  assert.deepEqual(findBranchPrefixOverlaps(files), [
    {ancestorPath:'conf',nestedPath:'conf/deeper/time.json',ancestorBranches:['branch-a'],nestedBranches:['branch-c']},
    {ancestorPath:'conf',nestedPath:'conf/places.json',ancestorBranches:['branch-a'],nestedBranches:['branch-b']},
  ]);
});

test('does not flag ancestor changes within only one branch', () => {
  assert.deepEqual(findBranchPrefixOverlaps(new Map([
    ['a', ['branch-a']], ['a/b', ['branch-a']], ['a/b/c', ['branch-a']]
  ])), []);
});

test('cross-branch candidates are deterministic and retain attribution', () => {
  assert.deepEqual(findBranchPrefixOverlaps(new Map([
    ['a/d', ['z', 'a']], ['a', ['z', 'b']]
  ])), [
    {ancestorPath:'a',nestedPath:'a/d',ancestorBranches:['b','z'],nestedBranches:['a','z']},
  ]);
});

test('base-side prefix candidates detect both orientations and ignore exact matches', () => {
  assert.deepEqual(findBasePrefixOverlaps('feature',
    ['config','assets/icons/new.svg','same','unrelated'],
    ['config/theme.json','assets','same','other']), [
    {branch:'feature',basePath:'assets',branchPath:'assets/icons/new.svg'},
    {branch:'feature',basePath:'config/theme.json',branchPath:'config'},
  ]);
});

test('base-side duplicate changed paths do not duplicate candidates', () => {
  assert.deepEqual(findBasePrefixOverlaps('feature', ['a/b','a/b'], ['a','a']),
    [{branch:'feature',basePath:'a',branchPath:'a/b'}]);
});

test('report includes both cross-branch and main-side prefix review candidates', async () => {
  const {report} = await import('../scripts/branch-overlap-report.mjs');
  const result = report('main', [
    {branch:'flat',paths:['config'],behindBy:1,aheadBy:1,baseSidePaths:['storage']},
    {branch:'nested',paths:['config/state.json','storage/cache.json'],behindBy:1,aheadBy:1,
      baseSidePaths:['storage']},
  ]);
  assert.equal(result.overlapFiles, 0);
  assert.equal(result.baseOverlapFiles, 0);
  assert.equal(result.prefixOverlapFiles, 1);
  assert.deepEqual(result.prefixOverlaps, [{
    ancestorPath:'config',nestedPath:'config/state.json',
    ancestorBranches:['flat'],nestedBranches:['nested']
  }]);
  assert.equal(result.basePrefixOverlapFiles, 1);
  assert.deepEqual(result.basePrefixOverlaps, [{
    branch:'nested',basePath:'storage',branchPath:'storage/cache.json'
  }]);
});

function git(dir, ...args) {
  const r = spawnSync('git', args, {cwd:dir,encoding:'utf8'});
  assert.equal(r.status, 0, `synthetic Git ${args[0]} failed`);
  return r.stdout.trim();
}

test('real local Git refs detect non-exact collisions without changing tree or HEAD', t => {
  const dir = mkdtempSync(join(tmpdir(), 'vs-prefix-audit-'));
  t.after(() => rmSync(dir, {recursive:true,force:true}));
  git(dir,'init','-q','-b','main');
  git(dir,'config','user.email','fixture@example.invalid');
  git(dir,'config','user.name','Fictional Contributor');
  writeFileSync(join(dir,'baseline.txt'),'fictional starting tree\n');
  git(dir,'add','.'); git(dir,'commit','-qm','baseline');
  git(dir,'branch','nested'); git(dir,'branch','flat');

  git(dir,'switch','-q','nested');
  mkdirSync(join(dir,'config'));
  mkdirSync(join(dir,'storage'));
  writeFileSync(join(dir,'config','state.json'),'{}\n');
  writeFileSync(join(dir,'storage','cache.json'),'{}\n');
  git(dir,'add','.'); git(dir,'commit','-qm','nested files');

  git(dir,'switch','-q','flat');
  writeFileSync(join(dir,'config'),'flat file\n');
  git(dir,'add','.'); git(dir,'commit','-qm','flat file');

  git(dir,'switch','-q','main');
  writeFileSync(join(dir,'storage'),'main flat file\n');
  git(dir,'add','.'); git(dir,'commit','-qm','main flat file');

  const beforeHead = git(dir,'rev-parse','HEAD');
  const source = resolve(import.meta.dirname, '../scripts/branch-overlap-report.mjs');
  const result = spawnSync(process.execPath,
    [source,'--base=main','nested','flat','--json'], {cwd:dir,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.overlapFiles,0,'no exact same path across branches');
  assert.equal(data.baseOverlapFiles,0,'no exact same path versus main');
  assert.deepEqual(data.prefixOverlaps,[{
    ancestorPath:'config',nestedPath:'config/state.json',
    ancestorBranches:['flat'],nestedBranches:['nested']
  }]);
  assert.deepEqual(data.basePrefixOverlaps,[{
    branch:'nested',basePath:'storage',branchPath:'storage/cache.json'
  }]);
  assert.equal(git(dir,'rev-parse','HEAD'),beforeHead);
  assert.equal(git(dir,'branch','--show-current'),'main');
  assert.equal(git(dir,'status','--porcelain'),'');
});

test('cross-branch collision count accepts cap but rejects the next candidate', () => {
  const paths=Array.from({length:MAX_PREFIX_COLLISION_PAIRS+1},(_,i)=>['root/item-'+i,['b']]);
  const accepted=new Map([['root',['a']],...paths.slice(0,MAX_PREFIX_COLLISION_PAIRS)]);
  assert.equal(findBranchPrefixOverlaps(accepted).length,MAX_PREFIX_COLLISION_PAIRS);
  assert.throws(()=>findBranchPrefixOverlaps(new Map([['root',['a']],...paths])),
    /Too many file-directory prefix collisions/);
});

test('base-side collision count accepts cap but rejects the next candidate', () => {
  const paths=Array.from({length:MAX_PREFIX_COLLISION_PAIRS+1},(_,i)=>'root/item-'+i);
  assert.equal(findBasePrefixOverlaps('branch',['root'],paths.slice(0,-1)).length,
    MAX_PREFIX_COLLISION_PAIRS);
  assert.throws(()=>findBasePrefixOverlaps('branch',['root'],paths),
    /Too many file-directory prefix collisions/);
});

test('report rejects combined feature and base prefix candidates beyond the shared budget', async () => {
  const {report}=await import('../scripts/branch-overlap-report.mjs');
  const inside=Array.from({length:600},(_,i)=>'config/child-'+i);
  const base=Array.from({length:600},(_,i)=>'old/item-'+i);
  assert.throws(()=>report('main',[
    {branch:'a',paths:['config',...base],behindBy:1,aheadBy:1,baseSidePaths:['old']},
    {branch:'b',paths:inside,behindBy:0,aheadBy:1,baseSidePaths:[]},
  ]),/Too many file-directory prefix collisions/);
});

test('report rejects accumulated main-side candidates even when each branch is individually below cap', async () => {
  const {report}=await import('../scripts/branch-overlap-report.mjs');
  const nested=(root)=>Array.from({length:600},(_,i)=>root+'/item-'+i);
  assert.throws(()=>report('main',[
    {branch:'a',paths:nested('alpha'),behindBy:1,aheadBy:1,baseSidePaths:['alpha']},
    {branch:'b',paths:nested('beta'),behindBy:1,aheadBy:1,baseSidePaths:['beta']},
  ]),/Too many file-directory prefix collisions/);
});
