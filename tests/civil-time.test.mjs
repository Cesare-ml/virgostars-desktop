import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCivilTime} from '../src/app/native/civil-time.ts';

const resolve = (date, time, timeZone = 'Europe/Rome') => resolveCivilTime({date, time, timeZone});

test('archive transfer can resolve historical dates without extending calculation defaults',()=>{
  assert.equal(resolve('1850-01-02','12:00:00','UTC').status,'invalid');
  const result=resolveCivilTime({date:'1850-01-02',time:'12:00:00',timeZone:'UTC'},{yearRange:'archive'});
  assert.equal(result.status,'resolved');
  assert.equal(result.choice.instantUtc,'1850-01-02T12:00:00.000Z');
  const ancient=resolveCivilTime({date:'0001-01-02',time:'12:00:00',timeZone:'UTC'},{yearRange:'archive'});
  assert.equal(ancient.status,'resolved');
  assert.equal(ancient.choice.instantUtc,'0001-01-02T12:00:00.000Z');
});

test('winter Rome UTC conversion is deterministic', () => {
  assert.deepEqual(resolve('2026-01-15', '08:05'), {
    status: 'resolved', timeZone: 'Europe/Rome',
    choice: {instantUtc: '2026-01-15T07:05:00.000Z', offsetSeconds: 3600},
  });
});
test('summer Rome UTC conversion has DST offset', () => {
  assert.deepEqual(resolve('2026-07-10', '12:30:15'), {
    status: 'resolved', timeZone: 'Europe/Rome',
    choice: {instantUtc: '2026-07-10T10:30:15.000Z', offsetSeconds: 7200},
  });
});
test('spring clock jump rejects nonexistent local time', () => {
  assert.deepEqual(resolve('2026-03-29', '02:30'), {status: 'nonexistent', timeZone: 'Europe/Rome'});
});
test('autumn clock rollback returns both instants in UTC order', () => {
  assert.deepEqual(resolve('2026-10-25', '02:30'), {
    status: 'ambiguous', timeZone: 'Europe/Rome', choices: [
      {instantUtc: '2026-10-25T00:30:00.000Z', offsetSeconds: 7200},
      {instantUtc: '2026-10-25T01:30:00.000Z', offsetSeconds: 3600},
    ],
  });
});
test('DST boundaries at the exact minute do not leak across adjacent hour', () => {
  assert.equal(resolve('2026-03-29', '01:59:59').choice?.instantUtc, '2026-03-29T00:59:59.000Z');
  assert.equal(resolve('2026-03-29', '03:00:00').choice?.instantUtc, '2026-03-29T01:00:00.000Z');
});
test('half-hour/quarter-hour zones are resolved without rounding', () => {
  assert.deepEqual(resolve('2026-05-05', '12:00', 'Asia/Kathmandu'), {
    status: 'resolved', timeZone: new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Kathmandu'}).resolvedOptions().timeZone,
    choice: {instantUtc: '2026-05-05T06:15:00.000Z', offsetSeconds: 20700},
  });
});
test('Pacific/Apia skipped calendar day is nonexistent', () => {
  assert.deepEqual(resolve('2011-12-30', '12:00', 'Pacific/Apia'), {
    status: 'nonexistent', timeZone: 'Pacific/Apia',
  });
});
test('UTC resolves without a time zone offset', () => {
  const x = resolve('2000-02-29', '00:00', 'UTC');
  assert.equal(x.status, 'resolved');
  assert.equal(x.choice?.offsetSeconds, 0);
  assert.equal(x.choice?.instantUtc, '2000-02-29T00:00:00.000Z');
});
test('the years 1900 to 2033 are accepted, with Gregorian leap years', () => {
  const utcDay = date => resolve(date, '12:00', 'UTC');
  for (const [date, instant] of [
    ['1900-01-01', '1900-01-01T12:00:00.000Z'], ['1904-02-29', '1904-02-29T12:00:00.000Z'],
    ['1999-12-31', '1999-12-31T12:00:00.000Z'], ['2000-02-29', '2000-02-29T12:00:00.000Z'],
    ['2026-11-17', '2026-11-17T12:00:00.000Z'], ['2033-12-31', '2033-12-31T12:00:00.000Z'],
  ]) {
    const result = utcDay(date);
    assert.equal(result.status, 'resolved', date);
    assert.equal(result.choice?.instantUtc, instant, date);
  }
  // 1900 and 2033 are not leap years; 2000 is.
  assert.deepEqual(utcDay('1900-02-29'), {status: 'invalid', code: 'INVALID_LOCAL_DATE'});
  assert.deepEqual(utcDay('2033-02-29'), {status: 'invalid', code: 'INVALID_LOCAL_DATE'});
  assert.equal(utcDay('2000-02-29').status, 'resolved');
});
test('dates outside the supported years are refused, not approximated', () => {
  for (const date of ['1899-12-31', '2034-01-01', '0000-06-01', '1800-06-01', '5000-12-31']) {
    assert.deepEqual(resolve(date, '12:00', 'Europe/Rome'), {status: 'invalid', code: 'INVALID_LOCAL_DATE'}, date);
  }
});
test('invalid calendar dates fail instead of overflowing into another month', () => {
  for (const date of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-00-12', '2026-13-01', '2034-01-01', '1899-12-31', '2026-1-01']) {
    assert.deepEqual(resolve(date, '12:00'), {status: 'invalid', code: 'INVALID_LOCAL_DATE'}, date);
  }
});
test('invalid or unsupported hour/minute/second rejects instead of normalizing', () => {
  for (const time of ['24:00', '12:60', '12:00:60', '1:23', '12:2', '12:00:0', '12:00Z', '12:00+02:00']) {
    assert.deepEqual(resolve('2026-01-01', time), {status: 'invalid', code: 'INVALID_LOCAL_TIME'}, time);
  }
});
test('invalid zones reject before constructing time zone formatter', () => {
  for (const zone of ['Europe/Does_Not_Exist', '../Rome', 'Europe/Rome\n', 'GMT+05:30', 'America/New York', 'http://example.org', '']) {
    assert.deepEqual(resolve('2026-01-01', '12:00', zone), {status: 'invalid', code: 'INVALID_TIME_ZONE'}, zone);
  }
});
test('invalid input does not throw or echo private birth values', () => {
  assert.deepEqual(resolveCivilTime(null), {status: 'invalid', code: 'INVALID_LOCAL_DATE'});
  assert.deepEqual(resolveCivilTime({date: 55, time: '12:00', timeZone: 'UTC'}), {status: 'invalid', code: 'INVALID_LOCAL_DATE'});
  assert.deepEqual(resolveCivilTime({date:'2026-01-01', time:null, timeZone:'UTC'}), {status:'invalid', code:'INVALID_LOCAL_TIME'});
});
test('results are deterministic under concurrent independent time zone queries', async () => {
  const results = await Promise.all(Array.from({length: 15}, (_, n) =>
    Promise.resolve(resolve('2026-10-25', n % 2 ? '02:30' : '03:30'))));
  for (let i = 0; i < results.length; i++) assert.equal(results[i].status, i % 2 ? 'ambiguous' : 'resolved');
});

test('Lord Howe thirty-minute DST rollback exposes two choices', () => {
  const x = resolve('2026-04-05', '01:45', 'Australia/Lord_Howe');
  assert.equal(x.status, 'ambiguous');
  assert.equal(x.choices.length, 2);
  assert.deepEqual(x.choices.map(c => c.offsetSeconds), [39600, 37800]);
});
test('negative timezone offset resolves without stripping the sign', () => {
  const x = resolve('2026-01-15', '08:05', 'America/New_York');
  assert.equal(x.status, 'resolved');
  assert.deepEqual(x.choice, {instantUtc:'2026-01-15T13:05:00.000Z', offsetSeconds:-18000});
});
test('historical timezone second offsets are not rounded to whole minutes', () => {
  const x = resolve('1900-01-15', '08:05', 'Europe/Amsterdam');
  assert.equal(x.status, 'resolved');
  assert.equal(Number.isInteger(x.choice.offsetSeconds), true);
  const recoveredWallUtc = Date.parse(x.choice.instantUtc) + x.choice.offsetSeconds * 1000;
  assert.equal(new Date(recoveredWallUtc).toISOString(), '1900-01-15T08:05:00.000Z');
});
