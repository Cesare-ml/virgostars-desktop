import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCivilTime} from '../src/app/native/civil-time.ts';

const valid = Object.freeze({date:'2026-01-15',time:'08:05',timeZone:'Europe/Rome'});
const expected = Object.freeze({status:'resolved',timeZone:'Europe/Rome',choice:{
  instantUtc:'2026-01-15T07:05:00.000Z',offsetSeconds:3600,
}});

test('changing getters are read exactly once per civil field', () => {
  let dateReads=0, timeReads=0, zoneReads=0;
  const input = {
    get date() { return ++dateReads === 1 ? valid.date : '2026-02-30'; },
    get time() { return ++timeReads === 1 ? valid.time : '25:00'; },
    get timeZone() { return ++zoneReads === 1 ? valid.timeZone : 'UTC'; },
  };
  assert.deepEqual(resolveCivilTime(input), expected);
  assert.deepEqual([dateReads,timeReads,zoneReads],[1,1,1]);
});

test('timezone accessor cannot switch from the checked IANA zone to another', () => {
  let reads=0;
  const input={...valid, get timeZone() { return ++reads===1 ? 'Europe/Rome' : 'UTC'; }};
  assert.deepEqual(resolveCivilTime(input), expected);
  assert.equal(reads,1);
});

test('invalid first read of civil fields is not retried', () => {
  const cases = [
    {field:'date', first:'2026-02-30', second:valid.date, code:'INVALID_LOCAL_DATE'},
    {field:'time', first:'25:00', second:valid.time, code:'INVALID_LOCAL_TIME'},
    {field:'timeZone', first:'Europe/Rome\n', second:valid.timeZone, code:'INVALID_TIME_ZONE'},
  ];
  for (const {field,first,second,code} of cases) {
    let reads=0;
    const input={...valid};
    Object.defineProperty(input,field,{get() { return ++reads === 1 ? first : second; }});
    assert.deepEqual(resolveCivilTime(input),{status:'invalid',code},field);
    assert.equal(reads,1,field);
  }
});

test('throwing individual getters produce stable sanitized errors', () => {
  const codes = {date:'INVALID_LOCAL_DATE',time:'INVALID_LOCAL_TIME',timeZone:'INVALID_TIME_ZONE'};
  for (const [field,code] of Object.entries(codes)) {
    const input={...valid};
    Object.defineProperty(input,field,{get() { throw new Error('private birth value'); }});
    assert.deepEqual(resolveCivilTime(input),{status:'invalid',code},field);
  }
});

test('revoked proxies and objects with throwing property traps never escape', () => {
  const {proxy,revoke}=Proxy.revocable({...valid},{});
  revoke();
  assert.deepEqual(resolveCivilTime(proxy),{status:'invalid',code:'INVALID_LOCAL_DATE'});
  assert.deepEqual(resolveCivilTime(new Proxy({...valid},{get(_target,name){
    if (name==='timeZone') throw new Error('hidden details');
    return Reflect.get(_target,name);
  }})),{status:'invalid',code:'INVALID_TIME_ZONE'});
});

test('invalid date does not access later untrusted civil getters', () => {
  let later=0;
  const input={date:'invalid-date',get time(){later++;throw new Error('should not read');},
    get timeZone(){later++;throw new Error('should not read');}};
  assert.deepEqual(resolveCivilTime(input),{status:'invalid',code:'INVALID_LOCAL_DATE'});
  assert.equal(later,0);
});

test('DST ambiguous hour still returns exactly two sorted UTC candidates', () => {
  const result=resolveCivilTime({date:'2026-10-25',time:'02:30',timeZone:'Europe/Rome'});
  assert.deepEqual(result,{status:'ambiguous',timeZone:'Europe/Rome',choices:[
    {instantUtc:'2026-10-25T00:30:00.000Z',offsetSeconds:7200},
    {instantUtc:'2026-10-25T01:30:00.000Z',offsetSeconds:3600},
  ]});
});
