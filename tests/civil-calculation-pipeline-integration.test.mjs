import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCivilTime} from '../src/app/native/civil-time.ts';
import {selectCivilInstant} from '../src/app/native/civil-time-choice.ts';
import {submitCivilCalculation} from '../src/app/native/civil-calculation-dispatch.ts';

// Fictional, ownerless input and recording-only port. No native ephemeris or accounts.
const rome = (date, time) => ({date, time, timeZone:'Europe/Rome'});
const place = () => ({latMicro:43_769_560, lngMicro:11_255_810});
const calculationKey = 'opaque.synthetic-session.1';
const selector = (input, selectedUtc) => selectCivilInstant(input, resolveCivilTime, selectedUtc);
function harness() {
  const drafts = [];
  const queue = {submit(draft) { drafts.push(draft); return drafts.length; }};
  const dispatch = (input, location=place(), selectedUtc=null) =>
    submitCivilCalculation(input, selector, location, calculationKey, queue, selectedUtc);
  return {drafts, dispatch};
}

test('winter Rome civil input reaches the mock queue as one canonical UTC and fixed coordinates', () => {
  const h=harness();
  const result=h.dispatch(rome('2026-01-15','08:05'));
  assert.equal(result.status,'submitted');
  assert.equal(result.requestSeq,1);
  assert.equal(result.selection.instantUtc,'2026-01-15T07:05:00.000Z');
  assert.equal(result.selection.timeZoneSource,'host_iana_unpinned');
  assert.deepEqual(h.drafts,[{
    intent:'committed',utcIso:'2026-01-15T07:05:00.000Z',
    latMicro:43_769_560,lngMicro:11_255_810,
    timeZone:'Europe/Rome',calculationKey,
  }]);
  assert.deepEqual(Object.keys(h.drafts[0]).sort(),
    ['intent','utcIso','latMicro','lngMicro','timeZone','calculationKey'].sort());
});

test('DST rollback refuses to queue before explicit exact UTC choice, then queues selected fold', () => {
  const h=harness();
  const fold=rome('2026-10-25','02:30');
  const first=h.dispatch(fold);
  assert.equal(first.status,'choice_required');
  assert.deepEqual(first.choices,[
    {instantUtc:'2026-10-25T00:30:00.000Z',offsetSeconds:7200},
    {instantUtc:'2026-10-25T01:30:00.000Z',offsetSeconds:3600},
  ]);
  assert.deepEqual(h.drafts,[]);
  const chosen=h.dispatch(fold,place(),first.choices[1].instantUtc);
  assert.equal(chosen.status,'submitted');
  assert.equal(chosen.selection.offsetSeconds,3600);
  assert.equal(h.drafts[0].utcIso,'2026-10-25T01:30:00.000Z');
});

test('a stale fold selection after date, hour or zone edit is not queued', () => {
  const h=harness();
  const old='2026-10-25T00:30:00.000Z';
  for (const input of [
    rome('2026-10-25','03:30'),rome('2026-10-25','02:31'),
    {date:'2026-10-25',time:'02:30',timeZone:'UTC'},
  ]) assert.equal(h.dispatch(input,place(),old).status,'selection_invalid');
  assert.deepEqual(h.drafts,[]);
});

test('DST gap, invalid date and skipped date-line day never reach the queue', () => {
  const h=harness();
  assert.equal(h.dispatch(rome('2026-03-29','02:30')).status,'nonexistent');
  assert.equal(h.dispatch(rome('2026-02-30','08:05')).status,'invalid');
  assert.equal(h.dispatch({date:'2011-12-30',time:'12:00',timeZone:'Pacific/Apia'}).status,'nonexistent');
  assert.deepEqual(h.drafts,[]);
});

test('changing civil and geographic property getters cannot alter the selected or queued values', () => {
  const h=harness();
  const reads={date:0,time:0,timeZone:0,latMicro:0,lngMicro:0};
  const civil={
    get date(){return ++reads.date===1?'2026-01-15':'2026-03-29';},
    get time(){return ++reads.time===1?'08:05':'02:30';},
    get timeZone(){return ++reads.timeZone===1?'Europe/Rome':'UTC';},
  };
  const location={
    get latMicro(){return ++reads.latMicro===1?43_769_560:100_000_000;},
    get lngMicro(){return ++reads.lngMicro===1?11_255_810:NaN;},
  };
  const result=h.dispatch(civil,location);
  assert.equal(result.status,'submitted');
  assert.deepEqual(reads,{date:1,time:1,timeZone:1,latMicro:1,lngMicro:1});
  assert.equal(result.selection.localDate,'2026-01-15');
  assert.equal(result.selection.localTime,'08:05');
  assert.equal(result.selection.instantUtc,'2026-01-15T07:05:00.000Z');
  assert.deepEqual([h.drafts[0].latMicro,h.drafts[0].lngMicro],[43_769_560,11_255_810]);
});

test('throwing civil getters return a sanitized invalid state; throwing coordinates block earlier', () => {
  const h=harness();
  const civil={...rome('2026-01-15','08:05'),get date(){throw Error('private birth value');}};
  assert.deepEqual(h.dispatch(civil),{status:'invalid',code:'TIME_ZONE_UNAVAILABLE'});
  const coordinates={get latMicro(){throw Error('private coordinates');},lngMicro:0};
  assert.deepEqual(h.dispatch(rome('2026-01-15','08:05'),coordinates),{status:'location_invalid'});
  assert.deepEqual(h.drafts,[]);
});

test('Lord Howe 30-minute rollback and Kathmandu 45-minute offset retain exact seconds', () => {
  const h=harness();
  const lord={date:'2026-04-05',time:'01:45',timeZone:'Australia/Lord_Howe'};
  const initial=h.dispatch(lord);
  assert.equal(initial.status,'choice_required');
  const chosen=h.dispatch(lord,place(),initial.choices[1].instantUtc);
  assert.equal(chosen.status,'submitted');
  assert.equal(chosen.selection.offsetSeconds,37800);
  const kath=h.dispatch({date:'2026-05-05',time:'12:00',timeZone:'Asia/Kathmandu'});
  assert.equal(kath.status,'submitted');
  assert.equal(kath.selection.offsetSeconds,20700);
  assert.equal(h.drafts[1].utcIso,'2026-05-05T06:15:00.000Z');
});

test('queue failure never reports success or exposes injected error text', () => {
  const result=submitCivilCalculation(rome('2026-01-15','08:05'),selector,place(),
    calculationKey,{submit(){throw Error('private pathname in mock');}});
  assert.deepEqual(result,{status:'queue_unavailable'});
});
