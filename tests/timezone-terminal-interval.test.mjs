import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCivilTime} from '../src/app/timezone-civil.ts';

// Entirely synthetic timezone inputs; no native ephemeris or birth records.
const civil=(year,month,day,hour,minute)=>({
  year,month,day,hour,minute,birthTimeKnown:true
});
const sample=civil(2024,8,9,12,0);
const stamp=value=>Date.parse(value);

test('a single finite terminal boundary is invalid timezone data, not a DST gap',()=>{
  const truncated={
    name:'Synthetic/Truncated',
    untils:[stamp('2024-01-01T00:00:00.000Z')],
    offsets:[-60],
  };
  const result=resolveCivilTime(sample,truncated,'synthetic-v1');
  assert.equal(result.status,'invalid_zone_data');
  assert.deepEqual(result.candidates,[]);
});

test('a multi-interval table with finite terminal boundary is rejected even if a matching interval exists',()=>{
  const truncated={
    name:'Synthetic/Truncated',
    untils:[stamp('2024-01-01T00:00:00.000Z'),stamp('2024-10-01T00:00:00.000Z')],
    offsets:[-60,-120],
  };
  assert.equal(resolveCivilTime(sample,truncated,'synthetic-v1').status,'invalid_zone_data');
  const early=civil(2023,6,1,12,0);
  assert.equal(resolveCivilTime(early,truncated,'synthetic-v1').status,'invalid_zone_data');
});

test('both supported unbounded final sentinels resolve ordinary local time',()=>{
  for(const terminal of [null,Infinity]){
    const zone={name:'Synthetic/UTC',untils:[terminal],offsets:[0]};
    const result=resolveCivilTime(sample,zone,'synthetic-v1');
    assert.equal(result.status,'unique');
    assert.deepEqual(result.candidates.map(c=>c.isoUtc),['2024-08-09T12:00:00.000Z']);
  }
});

test('noncanonical missing and invalid terminal markers fail closed',()=>{
  for(const terminal of [undefined,NaN,-Infinity,'Infinity',Number.MAX_SAFE_INTEGER]){
    const zone={name:'Synthetic/Invalid',untils:[terminal],offsets:[0]};
    const result=resolveCivilTime(sample,zone,'synthetic-v1');
    assert.equal(result.status,'invalid_zone_data',String(terminal));
    assert.deepEqual(result.candidates,[]);
  }
});

test('an Infinity-terminated Rome-like table still resolves DST gap and explicit fold',()=>{
  const rome={
    name:'Europe/Rome',
    untils:[stamp('2024-03-31T01:00:00.000Z'),stamp('2024-10-27T01:00:00.000Z'),Infinity],
    offsets:[-60,-120,-60],
  };
  assert.equal(resolveCivilTime(civil(2024,3,31,2,30),rome,'synthetic-v1').status,'nonexistent');
  const fold=resolveCivilTime(civil(2024,10,27,2,30),rome,'synthetic-v1');
  assert.equal(fold.status,'ambiguous');
  assert.deepEqual(fold.candidates.map(c=>c.isoUtc),[
    '2024-10-27T00:30:00.000Z','2024-10-27T01:30:00.000Z'
  ]);
});
