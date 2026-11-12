import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCivilInstant as select} from '../src/app/native/civil-time-choice.ts';
import {resolveCivilTime} from '../src/app/native/civil-time.ts';
const selectCivilInstant = (input, chosen = null) => select(input, resolveCivilTime, chosen);

const rome = (date,time) => ({date,time,timeZone:'Europe/Rome'});
const fold = rome('2026-10-25','02:30');
const utc1 = '2026-10-25T00:30:00.000Z';
const utc2 = '2026-10-25T01:30:00.000Z';

test('unambiguous winter birth instant resolves with its explicit provenance',()=>{
  assert.deepEqual(selectCivilInstant(rome('2026-01-15','08:05')), {
    status:'ready',localDate:'2026-01-15',localTime:'08:05',timeZone:'Europe/Rome',
    instantUtc:'2026-01-15T07:05:00.000Z',offsetSeconds:3600,
    timeZoneSource:'host_iana_unpinned',
  });
});
test('autumn DST rollback never guesses earlier or later automatically',()=>{
  assert.deepEqual(selectCivilInstant(fold),{
    status:'choice_required',timeZone:'Europe/Rome',choices:[
      {instantUtc:utc1,offsetSeconds:7200}, {instantUtc:utc2,offsetSeconds:3600},
    ],
  });
});
test('explicit earlier and later DST choices retain their correct offsets',()=>{
  const early=selectCivilInstant(fold,utc1),late=selectCivilInstant(fold,utc2);
  assert.equal(early.status,'ready'); assert.equal(early.offsetSeconds,7200);
  assert.equal(early.instantUtc,utc1); assert.equal(late.status,'ready');
  assert.equal(late.offsetSeconds,3600); assert.equal(late.instantUtc,utc2);
});
test('a stale UI choice is rejected after the entered civil time changes',()=>{
  assert.deepEqual(selectCivilInstant(rome('2026-10-25','03:30'),utc1),{status:'selection_invalid'});
  assert.deepEqual(selectCivilInstant(rome('2026-10-25','02:31'),utc1),{status:'selection_invalid'});
  assert.deepEqual(selectCivilInstant({date:fold.date,time:fold.time,timeZone:'UTC'},utc1),{status:'selection_invalid'});
});
test('an unknown instant, forged timezone offset or malformed selection is rejected',()=>{
  for(const chosen of [
    '2026-10-25T00:30:01.000Z','2026-10-25T00:30:00+00:00',
    '2026-10-25T00:30:00.000Z\n','javascript:alert(1)',0,{},'',
  ]) {
    assert.deepEqual(selectCivilInstant(fold,chosen), {status:'selection_invalid'});
  }
});
test('spring DST gap blocks calculation even with a selected UTC',()=>{
  assert.deepEqual(selectCivilInstant(rome('2026-03-29','02:30'),utc1),{status:'nonexistent',timeZone:'Europe/Rome'});
});
test('invalid date, time and zone remain sanitized and are never promoted to ready',()=>{
  assert.deepEqual(selectCivilInstant(rome('2026-02-30','08:05')),{status:'invalid',code:'INVALID_LOCAL_DATE'});
  assert.deepEqual(selectCivilInstant(rome('2026-01-15','25:00')),{status:'invalid',code:'INVALID_LOCAL_TIME'});
  assert.deepEqual(selectCivilInstant({date:'2026-01-15',time:'08:00',timeZone:'Europe/Bogus'}),{status:'invalid',code:'INVALID_TIME_ZONE'});
});
test('Lord Howe half-hour fold also requires user selection',()=>{
  const input={date:'2026-04-05',time:'01:45',timeZone:'Australia/Lord_Howe'};
  const initial=selectCivilInstant(input);
  assert.equal(initial.status,'choice_required');assert.equal(initial.choices.length,2);
  const later=selectCivilInstant(input,initial.choices[1].instantUtc);
  assert.equal(later.status,'ready');assert.equal(later.offsetSeconds,37800);
});
test('Kathmandu quarter-hour zone is preserved without minute rounding',()=>{
  const choice=selectCivilInstant({date:'2026-05-05',time:'12:00',timeZone:'Asia/Kathmandu'});
  assert.equal(choice.status,'ready');assert.equal(choice.offsetSeconds,20700);
  assert.equal(choice.instantUtc,'2026-05-05T06:15:00.000Z');
});
test('nonexistent calendar date-line day never returns fabricated UTC',()=>{
  const result=selectCivilInstant({date:'2011-12-30',time:'12:00',timeZone:'Pacific/Apia'});
  assert.equal(result.status,'nonexistent');
});
test('an explicit mismatched selection on a non-ambiguous date fails closed',()=>{
  assert.deepEqual(selectCivilInstant(rome('2026-01-15','08:05'),utc1),{status:'selection_invalid'});
});
