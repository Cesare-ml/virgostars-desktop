import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCivilInstant} from '../src/app/native/civil-time-choice.ts';

const ready = {status:'resolved',timeZone:'Europe/Rome',choice:{
  instantUtc:'2026-01-15T07:05:00.000Z',offsetSeconds:3600,
}};
const initial = () => ({date:'2026-01-15',time:'08:05',timeZone:'Europe/Rome'});

test('one getter read per civil field is used for resolution and for selected local labels', () => {
  const reads = {date:0,time:0,timeZone:0};
  const input = {
    get date() { return ++reads.date === 1 ? '2026-01-15' : '2026-02-30'; },
    get time() { return ++reads.time === 1 ? '08:05' : '25:00'; },
    get timeZone() { return ++reads.timeZone === 1 ? 'Europe/Rome' : 'Invalid/Bogus'; },
  };
  let seen;
  const actual = selectCivilInstant(input, value => {
    seen = value;
    return ready;
  });
  assert.deepEqual(reads,{date:1,time:1,timeZone:1});
  assert.equal(Object.isFrozen(seen),true);
  assert.deepEqual(seen, initial());
  assert.equal(actual.status,'ready');
  assert.deepEqual([actual.localDate,actual.localTime,actual.timeZone],
    ['2026-01-15','08:05','Europe/Rome']);
});

test('the resolver cannot mutate original input indirectly through its argument', () => {
  const input = initial();
  let sameReference;
  const actual = selectCivilInstant(input, civil => {
    sameReference = civil === input;
    input.date = '2026-03-29';
    input.time = '02:30';
    input.timeZone = 'UTC';
    return ready;
  });
  assert.equal(sameReference,false);
  assert.equal(actual.status,'ready');
  assert.equal(actual.localDate,'2026-01-15');
  assert.equal(actual.localTime,'08:05');
  assert.equal(actual.timeZone,'Europe/Rome');
});

test('a resolver that tries to rewrite the frozen civil request fails closed', () => {
  const result = selectCivilInstant(initial(), civil => {
    civil.date = '2026-03-29'; // modules are strict: attempting to mutate frozen input throws
    return ready;
  });
  assert.deepEqual(result,{status:'invalid',code:'TIME_ZONE_UNAVAILABLE'});
});

test('throwing getters fail closed before any resolver execution', () => {
  for (const key of ['date','time','timeZone']) {
    let calls=0;
    const input = initial();
    Object.defineProperty(input,key,{get(){throw new Error('private birthday');}});
    const result = selectCivilInstant(input,()=>{calls++;return ready;});
    assert.deepEqual(result,{status:'invalid',code:'TIME_ZONE_UNAVAILABLE'});
    assert.equal(calls,0);
  }
});

test('missing civil input returns sanitized invalid date', () => {
  let calls=0;
  for (const input of [null,undefined,1,'2026-01-15']) {
    assert.deepEqual(selectCivilInstant(input,()=>{calls++;return ready;}),
      {status:'invalid',code:'INVALID_LOCAL_DATE'});
  }
  assert.equal(calls,0);
});

test('ambiguous resolution still requires an explicit matching UTC instant', () => {
  const fold = {date:'2026-10-25',time:'02:30',timeZone:'Europe/Rome'};
  const result = {status:'ambiguous',timeZone:'Europe/Rome',choices:[
    {instantUtc:'2026-10-25T00:30:00.000Z',offsetSeconds:7200},
    {instantUtc:'2026-10-25T01:30:00.000Z',offsetSeconds:3600},
  ]};
  assert.equal(selectCivilInstant(fold,()=>result).status,'choice_required');
  const late = selectCivilInstant(fold,()=>result,'2026-10-25T01:30:00.000Z');
  assert.equal(late.status,'ready');
  assert.equal(late.offsetSeconds,3600);
  assert.deepEqual(selectCivilInstant(fold,()=>result,'2026-10-25T02:30:00.000Z'),
    {status:'selection_invalid'});
});
