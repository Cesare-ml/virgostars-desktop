import test from 'node:test';
import assert from 'node:assert/strict';
import {report, windowsCaseKey, MAX_WINDOWS_CASE_VARIANT_PAIRS} from '../scripts/branch-overlap-report.mjs';

test('Windows case variants are review signals separate from exact file overlaps', () => {
  const data=report('main', [
    {branch:'b',paths:['src/clock.ts','src/shared.ts']},
    {branch:'a',paths:['src/Clock.ts','src/shared.ts']},
  ]);
  assert.deepEqual(data.overlaps,[{path:'src/shared.ts',branches:['a','b']}]);
  assert.deepEqual(data.windowsCaseVariants,[
    {branchA:'a',pathA:'src/Clock.ts',branchB:'b',pathB:'src/clock.ts'},
  ]);
  assert.equal(data.windowsCaseVariantPairs,1);
  assert.equal(data.windowsBaseCaseVariantPairs,0);
  assert.match(data.note,/review/);
});

test('NFC and lowercase grouping catches Unicode variants without inventing exact overlap', () => {
  assert.equal(windowsCaseKey('docs/CITTÀ.md'),windowsCaseKey('docs/citta\u0300.md'));
  const data=report('main',[
    {branch:'alpha',paths:['docs/CITTÀ.md']},
    {branch:'beta',paths:['docs/citta\u0300.md']},
  ]);
  assert.equal(data.overlapFiles,0);
  assert.equal(data.windowsCaseVariantPairs,1);
  assert.deepEqual(data.windowsCaseVariants,[
    {branchA:'alpha',pathA:'docs/CITTÀ.md',branchB:'beta',pathB:'docs/citta\u0300.md'},
  ]);
});

test('main-side case variant is reported only when a checked base-side path differs', () => {
  const data=report('main',[
    {branch:'alpha',paths:['src/Settings.ts','docs/exact.md'],
      baseSidePaths:['src/settings.ts','docs/exact.md'],
      behindBy:2,aheadBy:1},
    {branch:'beta',paths:['src/unrelated.ts'],baseSidePaths:[],
      behindBy:0,aheadBy:1},
  ]);
  assert.equal(data.baseOverlapFiles,1);
  assert.deepEqual(data.baseOverlaps,[{branch:'alpha',path:'docs/exact.md'}]);
  assert.deepEqual(data.windowsBaseCaseVariants,[
    {branch:'alpha',branchPath:'src/Settings.ts',basePath:'src/settings.ts'},
  ]);
  assert.equal(data.windowsBaseCaseVariantPairs,1);
  assert.deepEqual(data.windowsCaseVariants,[]);
});

test('same-branch variants do not create false cross-branch pairs, and duplicates are deduplicated', () => {
  const data=report('main',[
    {branch:'alpha',paths:['dir/X.ts','dir/x.ts','dir/X.ts']},
    {branch:'beta',paths:['dir/other.ts']},
  ]);
  assert.equal(data.branches[0].changedFiles,2);
  assert.deepEqual(data.windowsCaseVariants,[]);
  assert.equal(data.windowsCaseVariantPairs,0);
});

test('pairs are deterministically sorted and exact-spelling pairs never double-count', () => {
  const data=report('main',[
    {branch:'z',paths:['B.ts','A.ts','Shared.ts']},
    {branch:'a',paths:['b.ts','a.ts','Shared.ts']},
  ]);
  assert.deepEqual(data.windowsCaseVariants,[
    {branchA:'a',pathA:'a.ts',branchB:'z',pathB:'A.ts'},
    {branchA:'a',pathA:'b.ts',branchB:'z',pathB:'B.ts'},
  ]);
  assert.equal(data.overlapFiles,1);
  assert.equal(data.windowsCaseVariantPairs,2);
});

test('invalid paths fail closed before case comparisons', () => {
  for (const invalid of ['',null,42,'a\0b']) {
    assert.throws(()=>windowsCaseKey(invalid),/Invalid path/);
    assert.throws(()=>report('main',[
      {branch:'a',paths:[invalid]},
      {branch:'b',paths:['valid.ts']},
    ]),/Invalid path/);
  }
});

function caseVariants(count,offset=0) {
  return Array.from({length:count},(_,i)=>{
    const mask=(i+offset).toString(2).padStart(7,'0');
    return 'dir/'+[...'abcdefg'].map((letter,j)=>mask[j]==='1'?letter.toUpperCase():letter).join('')+'.ts';
  });
}

test('normalization batches with many aliases in one branch stay linear in emitted cross-branch pairs',()=>{
  const names=caseVariants(120);
  const result=report('main',[
    {branch:'feature',paths:names},
    {branch:'unrelated',paths:['src/other.ts']},
  ]);
  assert.equal(result.branches[0].changedFiles,120);
  assert.equal(result.windowsCaseVariantPairs,0);
});

test('bounded output accepts exactly the candidate cap and rejects any further aliases',()=>{
  const accepted=report('main',[
    {branch:'a',paths:caseVariants(32)},
    {branch:'b',paths:caseVariants(32,32)},
  ]);
  assert.equal(accepted.windowsCaseVariantPairs,MAX_WINDOWS_CASE_VARIANT_PAIRS);
  assert.equal(accepted.windowsCaseVariants.length,MAX_WINDOWS_CASE_VARIANT_PAIRS);
  assert.throws(()=>report('main',[
    {branch:'a',paths:caseVariants(33)},
    {branch:'b',paths:caseVariants(32,33)},
  ]),/Too many Windows case variants/);
});

test('combined base-side and cross-branch aliases share one overflow budget',()=>{
  const data=report('main',[
    {branch:'a',paths:caseVariants(32),baseSidePaths:['src/unrelated.ts'],behindBy:1,aheadBy:1},
    {branch:'b',paths:caseVariants(32,32),baseSidePaths:[],behindBy:0,aheadBy:1},
  ]);
  assert.equal(data.windowsCaseVariantPairs,MAX_WINDOWS_CASE_VARIANT_PAIRS);
  assert.equal(data.windowsBaseCaseVariantPairs,0);

  assert.throws(()=>report('main',[
    {branch:'a',paths:caseVariants(32),baseSidePaths:caseVariants(32,32),behindBy:1,aheadBy:1},
    {branch:'b',paths:caseVariants(32,64),baseSidePaths:[],behindBy:0,aheadBy:1},
  ]),/Too many Windows case variants/);
});
