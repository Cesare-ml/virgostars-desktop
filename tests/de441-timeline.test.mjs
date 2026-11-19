import test from 'node:test';
import assert from 'node:assert/strict';
import {coverageTimeline, yearLabel} from '../src/app/de441-timeline.ts';

const row=(firstYear,lastYear,installed,required=false)=>({id:String(firstYear),firstYear,lastYear,installed,required,bytes:100});
const catalog=[row(600,799,false),row(800,999,false),row(1000,2200,true,true),row(2201,2400,false),row(2401,2600,false)];

test('the timeline moves only to whole adjacent boundaries from the installed span',()=>{
  const view=coverageTimeline(catalog);
  assert.deepEqual(view.firstChoices,[600,800,1000]);
  assert.deepEqual(view.lastChoices,[2200,2400,2600]);
  assert.equal(view.earliestRemovable,null);
  assert.equal(view.latestRemovable,null);
  const expanded=coverageTimeline(catalog.map(p=>({...p,installed:p.firstYear===800||p.firstYear===1000||p.firstYear===2201})));
  assert.deepEqual(expanded.firstChoices,[600,800]);
  assert.deepEqual(expanded.lastChoices,[2400,2600]);
  assert.equal(expanded.earliestRemovable.firstYear,800);
  assert.equal(expanded.latestRemovable.firstYear,2201);
});

test('a missing bridge or required range cannot produce a misleading timeline',()=>{
  assert.equal(coverageTimeline(catalog.map(p=>({...p,installed:p.firstYear===600||p.installed}))),null);
  assert.equal(coverageTimeline(catalog.map(p=>({...p,installed:false}))),null);
  assert.equal(coverageTimeline([catalog[1],catalog[2],catalog[4]]),null);
});

test('dates use familiar BCE/CE labels including astronomical year zero',()=>{
  assert.equal(yearLabel(0,'it'),'1 a.C.');
  assert.equal(yearLabel(-12999,'it'),'13000 a.C.');
  assert.equal(yearLabel(2200,'it'),'2200 d.C.');
  assert.equal(yearLabel(0,'en'),'1 BCE');
});
