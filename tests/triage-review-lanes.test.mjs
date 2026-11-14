import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {planReviewLanes} from '../scripts/triage-review-lanes.mjs';

const script = resolve(import.meta.dirname,'../scripts/triage-review-lanes.mjs');
const overlapScript = resolve(import.meta.dirname,'../scripts/branch-overlap-report.mjs');

function fixture() {
  return {
    base:'main',freshnessChecked:true,baseFilesChecked:true,
    branches:[
      {branch:'a',changedFiles:1,behindBy:0,aheadBy:1},
      {branch:'b',changedFiles:2,behindBy:2,aheadBy:1},
      {branch:'c',changedFiles:1,behindBy:0,aheadBy:1},
      {branch:'d',changedFiles:1,behindBy:0,aheadBy:1},
    ],
    staleBranches:['b'],
    overlapFiles:2,
    overlaps:[
      {path:'one.txt',branches:['a','b']},
      {path:'two.txt',branches:['b','c']},
    ],
    baseOverlapFiles:1,
    baseOverlaps:[{branch:'b',path:'one.txt'}],
  };
}

test('deterministic disjoint review lanes retain base risks',()=>{
  const result=planReviewLanes(fixture());
  assert.equal(result.branchCount,4);
  assert.equal(result.sharedPathCount,2);
  assert.deepEqual(result.lanes,[
    {branches:['b','d'],requiresBaseRefresh:['b'],baseOverlapBranches:['b'],
      basePrefixOverlapBranches:[],windowsBaseCaseVariantBranches:[]},
    {branches:['a','c'],requiresBaseRefresh:[],baseOverlapBranches:[],
      basePrefixOverlapBranches:[],windowsBaseCaseVariantBranches:[]},
  ]);
  assert.match(result.note,/no lane implies merge safety/i);
  const reversed=fixture();
  reversed.branches.reverse();
  reversed.overlaps.reverse();
  reversed.overlaps[0].branches.reverse();
  assert.deepEqual(planReviewLanes(reversed),result);
});

test('all branches sharing a path must occupy different lanes',()=>{
  const data=fixture();
  data.overlaps=[{path:'common',branches:['d','c','b','a']}];
  data.overlapFiles=1;
  const result=planReviewLanes(data);
  assert.equal(result.lanes.length,4);
  assert.deepEqual(result.lanes.map(lane=>lane.branches),[['a'],['b'],['c'],['d']]);
});

test('missing, contradictory and duplicated evidence fails closed',()=>{
  const edits=[
    data=>{data.freshnessChecked=false;},
    data=>{data.baseFilesChecked=false;},
    data=>{data.staleBranches=[];},
    data=>{data.branches[0].behindBy=-1;},
    data=>{data.branches[1].changedFiles=1;},
    data=>{data.branches[1].branch='a';},
    data=>{data.overlapFiles=1;},
    data=>{data.overlaps[0].branches=['a','a'];},
    data=>{data.overlaps[0].branches=['a','outside'];},
    data=>{data.overlaps[1].path='one.txt';},
    data=>{data.baseOverlaps.push(data.baseOverlaps[0]);data.baseOverlapFiles=2;},
    data=>{data.branches[1].behindBy=0;data.staleBranches=[];},
    data=>{data.overlaps[0].path='bad\0path';},
    data=>{data.branches[0].branch='--bad';},
  ];
  for (const edit of edits) {
    const data=fixture();edit(data);
    assert.throws(()=>planReviewLanes(data), 'invalid audit must not be scheduled');
  }
});


test('file-directory collisions split otherwise shared review lanes',()=>{
  const data=fixture();
  data.prefixOverlapFiles=1;
  data.prefixOverlaps=[{
    ancestorPath:'two.txt',nestedPath:'two.txt/options',
    ancestorBranches:['b'],nestedBranches:['d'],
  }];
  const result=planReviewLanes(data);
  assert.equal(result.fileDirectoryCollisionCount,1);
  assert.equal(result.lanes.length,2);
  assert.ok(!result.lanes.some(lane=>lane.branches.includes('b')&&lane.branches.includes('d')));
  assert.deepEqual(new Set(result.lanes.flatMap(lane=>lane.branches)),
    new Set(['a','b','c','d']));
});

test('Windows case variants split a third review lane',()=>{
  const data=fixture();
  data.branches[2].changedFiles=2; // c also edits a different Windows-cased path
  data.windowsCaseVariantPairs=1;
  data.windowsCaseVariants=[{
    branchA:'a',pathA:'one.txt',branchB:'c',pathB:'ONE.TXT',
  }];
  const result=planReviewLanes(data);
  assert.equal(result.windowsCaseCollisionCount,1);
  assert.equal(result.lanes.length,3,'a, b and c form a triangle of review risks');
  assert.ok(!result.lanes.some(lane=>lane.branches.includes('a')&&lane.branches.includes('c')));
});

test('base-side prefix and case-only collisions remain visible in review output',()=>{
  const data=fixture();
  data.basePrefixOverlapFiles=1;
  data.basePrefixOverlaps=[{
    branch:'b',basePath:'two.txt/options',branchPath:'two.txt',
  }];
  data.windowsBaseCaseVariantPairs=1;
  data.windowsBaseCaseVariants=[{
    branch:'b',branchPath:'two.txt',basePath:'TWO.TXT',
  }];
  const result=planReviewLanes(data);
  const lane=result.lanes.find(lane=>lane.branches.includes('b'));
  assert.deepEqual(lane.basePrefixOverlapBranches,['b']);
  assert.deepEqual(lane.windowsBaseCaseVariantBranches,['b']);
  assert.deepEqual(lane.baseOverlapBranches,['b']);
  assert.deepEqual(lane.requiresBaseRefresh,['b']);
});

test('partial and invalid newer audit fields fail closed without unsafe grouping',()=>{
  const edits=[
    data=>{data.prefixOverlapFiles=1;},
    data=>{data.prefixOverlaps=[];},
    data=>{data.windowsCaseVariantPairs=0;},
    data=>{data.windowsBaseCaseVariants=[];},
    data=>{data.basePrefixOverlapFiles=1;data.basePrefixOverlaps=[];},
    data=>{data.prefixOverlapFiles=1;data.prefixOverlaps=[{
      ancestorPath:'config',nestedPath:'cfg/other',
      ancestorBranches:['a'],nestedBranches:['d'],
    }];},
    data=>{data.prefixOverlapFiles=1;data.prefixOverlaps=[{
      ancestorPath:'config',nestedPath:'config/item',
      ancestorBranches:['a'],nestedBranches:['a'],
    }];},
    data=>{data.prefixOverlapFiles=1;data.prefixOverlaps=[{
      ancestorPath:'config',nestedPath:'config/item',
      ancestorBranches:['a'],nestedBranches:['missing'],
    }];},
    data=>{data.windowsCaseVariantPairs=1;data.windowsCaseVariants=[{
      branchA:'a',pathA:'Alpha.ts',branchB:'c',pathB:'not-alpha.ts',
    }];},
    data=>{data.windowsCaseVariantPairs=1;data.windowsCaseVariants=[{
      branchA:'a',pathA:'Alpha.ts',branchB:'a',pathB:'alpha.ts',
    }];},
    data=>{data.basePrefixOverlapFiles=1;data.basePrefixOverlaps=[{
      branch:'a',basePath:'two.txt/item',branchPath:'two.txt',
    }];},
    data=>{data.windowsBaseCaseVariantPairs=1;data.windowsBaseCaseVariants=[{
      branch:'a',branchPath:'Alpha.ts',basePath:'alpha.ts',
    }];},
  ];
  for (const edit of edits) {
    const data=fixture();
    edit(data);
    assert.throws(()=>planReviewLanes(data),'malformed optional collision data must block lanes');
  }
});

test('unchecked collision categories stay unknown, not zero',()=>{
  const legacy=planReviewLanes(fixture());
  assert.equal(legacy.fileDirectoryCollisionCount,null);
  assert.equal(legacy.windowsCaseCollisionCount,null);
  assert.deepEqual(legacy.checks,{
    exactPath:true,baseSide:true,localBranchFreshness:true,
    fileDirectory:false,baseFileDirectory:false,
    windowsCase:false,windowsBaseCase:false,
  });
  assert.match(legacy.note,/Unchecked Windows-case/i);
  const fullyChecked=fixture();
  fullyChecked.prefixOverlapFiles=0; fullyChecked.prefixOverlaps=[];
  fullyChecked.basePrefixOverlapFiles=0; fullyChecked.basePrefixOverlaps=[];
  fullyChecked.windowsCaseVariantPairs=0; fullyChecked.windowsCaseVariants=[];
  fullyChecked.windowsBaseCaseVariantPairs=0; fullyChecked.windowsBaseCaseVariants=[];
  const report=planReviewLanes(fullyChecked);
  assert.equal(report.fileDirectoryCollisionCount,0);
  assert.equal(report.windowsCaseCollisionCount,0);
  assert.ok(Object.values(report.checks).every(Boolean));
  assert.deepEqual(report.lanes,legacy.lanes,'zero-reported collisions preserve grouping');
});

test('unknown future reporter risk fields never silently become an all-clear',()=>{
  const data=fixture();
  data.newSecurityRiskPairs=1;
  data.newSecurityRisks=[{branchA:'a',branchB:'d'}];
  assert.throws(()=>planReviewLanes(data),/Unknown audit schema/);
  const empty=fixture();
  empty.newSecurityRiskPairs=0;
  empty.newSecurityRisks=[];
  assert.throws(()=>planReviewLanes(empty),/Unknown audit schema/);
});

test('pair summary identifies exact, prefix and Windows-case reviewer risks',()=>{
  const data=fixture();
  data.branches[2].changedFiles=2;
  data.prefixOverlapFiles=1;
  data.prefixOverlaps=[{
    ancestorPath:'two.txt',nestedPath:'two.txt/settings',
    ancestorBranches:['b'],nestedBranches:['d'],
  }];
  data.windowsCaseVariantPairs=1;
  data.windowsCaseVariants=[{
    branchA:'b',pathA:'two.txt',branchB:'c',pathB:'TWO.TXT',
  }];
  const result=planReviewLanes(data);
  assert.equal(result.reviewPairCount,3);
  assert.deepEqual(result.reviewPairs,[
    {branches:['a','b'],reasons:['exact-path']},
    {branches:['b','c'],reasons:['exact-path','windows-case']},
    {branches:['b','d'],reasons:['file-directory']},
  ]);
  for (const lane of result.lanes) {
    assert.ok(!result.reviewPairs.some(pair =>
      pair.branches.every(member => lane.branches.includes(member))),
      'no reported conflicting pair may share a review lane');
  }
  assert.ok(!JSON.stringify(result.reviewPairs).includes('settings'),
    'scheduling reason summary must not expose local paths');
});

test('pair summary remains stable across branch and collision input ordering',()=>{
  const first=fixture();
  first.branches[2].changedFiles=2;
  first.windowsCaseVariantPairs=1;
  first.windowsCaseVariants=[{branchA:'b',pathA:'two.txt',branchB:'c',pathB:'TWO.TXT'}];
  const expected=planReviewLanes(first);
  const reversed=structuredClone(first);
  reversed.branches.reverse();
  reversed.overlaps.reverse();
  reversed.overlaps.forEach(row => row.branches.reverse());
  assert.deepEqual(planReviewLanes(reversed).reviewPairs,expected.reviewPairs);
  assert.equal(expected.reviewPairCount,2);
});

test('seeded graph sweep keeps every reported risk pair in separate lanes',()=>{
  let seed=0x52a1f306;
  const next=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/0x100000000);
  for(let sample=0;sample<120;sample++){
    const n=2+Math.floor(next()*16);
    const branches=Array.from({length:n},(_,i)=>({
      branch:'case-'+String(i).padStart(2,'0'),
      changedFiles:0,behindBy:0,aheadBy:1,
    }));
    const touched=new Map(branches.map(b=>[b.branch,new Set()]));
    const overlaps=[],prefixOverlaps=[],windowsCaseVariants=[];
    const expected=new Map();
    function register(i,j,reason,leftPath,rightPath){
      const a=branches[i].branch,b=branches[j].branch;
      const key=a+'\0'+b;
      if(!expected.has(key))expected.set(key,new Set());
      expected.get(key).add(reason);
      touched.get(a).add(leftPath);
      touched.get(b).add(rightPath);
    }
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
      const stem=i+'-'+j;
      if(next()<0.28){
        const path='exact/'+stem+'.ts';
        overlaps.push({path,branches:[branches[i].branch,branches[j].branch]});
        register(i,j,'exact-path',path,path);
      }
      if(next()<0.22){
        const ancestor='nested/branch-'+stem;
        const child=ancestor+'/child';
        prefixOverlaps.push({ancestorPath:ancestor,nestedPath:child,
          ancestorBranches:[branches[i].branch],nestedBranches:[branches[j].branch]});
        register(i,j,'file-directory',ancestor,child);
      }
      if(next()<0.23){
        const a='windows/Name-'+stem+'.ts',b='windows/name-'+stem+'.ts';
        windowsCaseVariants.push({branchA:branches[i].branch,pathA:a,
          branchB:branches[j].branch,pathB:b});
        register(i,j,'windows-case',a,b);
      }
    }
    for(const b of branches)b.changedFiles=touched.get(b.branch).size;
    const report={
      base:'main',freshnessChecked:true,baseFilesChecked:true,
      branches,staleBranches:[],
      overlapFiles:overlaps.length,overlaps,
      baseOverlapFiles:0,baseOverlaps:[],
      prefixOverlapFiles:prefixOverlaps.length,prefixOverlaps,
      windowsCaseVariantPairs:windowsCaseVariants.length,windowsCaseVariants,
    };
    const result=planReviewLanes(report);
    assert.equal(result.reviewPairCount,expected.size);
    assert.equal(result.reviewPairs.length,expected.size);
    for(const {branches:pair,reasons} of result.reviewPairs){
      const key=pair.join('\0');
      assert.deepEqual(reasons,[...expected.get(key)].sort());
      assert.ok(!result.lanes.some(lane=>pair.every(b=>lane.branches.includes(b))),
        'collision pair '+key+' not separated in sample '+sample);
    }
    assert.deepEqual(result.lanes.flatMap(lane=>lane.branches).sort(),
      branches.map(b=>b.branch).sort());
    const reversed=structuredClone(report);
    reversed.branches.reverse();reversed.overlaps.reverse();
    reversed.prefixOverlaps.reverse();reversed.windowsCaseVariants.reverse();
    assert.deepEqual(planReviewLanes(reversed),result,'randomized input order sample '+sample);
  }
});

test('CLI accepts only bounded complete JSON over standard input',()=>{
  const good=spawnSync(process.execPath,[script],{
    input:JSON.stringify(fixture()),encoding:'utf8'
  });
  assert.equal(good.status,0,good.stderr);
  assert.equal(JSON.parse(good.stdout).lanes.length,2);
  for (const input of ['{bad', '', '{}', 'x'.repeat(2*1024*1024+1)]) {
    const bad=spawnSync(process.execPath,[script],{input,encoding:'utf8'});
    assert.equal(bad.status,2);
    assert.equal(bad.stdout,'');
    assert.match(bad.stderr,/Invalid or incomplete/);
    if (input.length) assert.ok(!bad.stderr.includes(input.slice(0,100)));
  }
  const flags=spawnSync(process.execPath,[script,'--auto-merge'],{
    input:JSON.stringify(fixture()),encoding:'utf8'
  });
  assert.equal(flags.status,2);
  assert.equal(flags.stdout,'');
});

function git(dir,...args) {
  const result=spawnSync('git',args,{cwd:dir,encoding:'utf8'});
  assert.equal(result.status,0,'Synthetic Git operation failed: '+args[0]);
  return result.stdout.trim();
}

test('end-to-end Git audit pipe creates lanes without checkout or writes',t=>{
  const dir=mkdtempSync(join(tmpdir(),'vs-review-lanes-'));
  t.after(()=>rmSync(dir,{force:true,recursive:true}));
  git(dir,'init','-q','-b','main');
  git(dir,'config','user.email','test@example.invalid');
  git(dir,'config','user.name','Synthetic Reviewer');
  writeFileSync(join(dir,'shared.txt'),'synthetic base\n');
  git(dir,'add','.');git(dir,'commit','-qm','base');
  for (const branch of ['a','b','c']) git(dir,'branch',branch);
  for (const branch of ['a','b']) {
    git(dir,'switch','-q',branch);
    writeFileSync(join(dir,'shared.txt'),'fictional '+branch+'\n');
    git(dir,'add','.');git(dir,'commit','-qm',branch);
  }
  git(dir,'switch','-q','c');
  writeFileSync(join(dir,'independent.txt'),'fictional c\n');
  git(dir,'add','.');git(dir,'commit','-qm','c');
  const head=git(dir,'rev-parse','HEAD');
  const audit=spawnSync(process.execPath,[overlapScript,'--json','a','b','c'],{
    cwd:dir,encoding:'utf8'
  });
  assert.equal(audit.status,0,audit.stderr);
  const lanes=spawnSync(process.execPath,[script],{
    cwd:dir,input:audit.stdout,encoding:'utf8'
  });
  assert.equal(lanes.status,0,lanes.stderr);
  const result=JSON.parse(lanes.stdout);
  assert.equal(result.branchCount,3);
  assert.equal(result.sharedPathCount,1);
  assert.equal(result.lanes.length,2);
  assert.equal(result.lanes.flatMap(lane=>lane.branches).sort().join(','),'a,b,c');
  assert.ok(!result.lanes.some(lane=>lane.branches.includes('a')&&lane.branches.includes('b')));
  assert.equal(git(dir,'rev-parse','HEAD'),head);
  assert.equal(git(dir,'branch','--show-current'),'c');
  assert.equal(git(dir,'status','--porcelain'),'');
});
