import test from 'node:test';
import assert from 'node:assert/strict';
import {submitCivilCalculation} from '../src/app/native/civil-calculation-dispatch.ts';

// Fictional fixture; a real civil-time resolver is tested separately.
const input = Object.freeze({date:'2026-01-15',time:'08:05',timeZone:'Europe/Rome'});
const validChoice = Object.freeze({
  status:'ready',localDate:input.date,localTime:input.time,timeZone:input.timeZone,
  instantUtc:'2026-01-15T07:05:00.000Z',offsetSeconds:3600,
  timeZoneSource:'host_iana_unpinned',
});
const key = 'opaque.session_fixture.1';
const selector = () => validChoice;

test('coordinate accessors are each read once, and queue receives validated first values', () => {
  let latReads = 0, lngReads = 0;
  const location = {
    get latMicro() { return ++latReads === 1 ? 43_769_560 : 91_000_000; },
    get lngMicro() { return ++lngReads === 1 ? 11_255_810 : Infinity; },
  };
  const drafts = [];
  const queue = {submit(draft) { drafts.push(draft); return 1; }};
  const result = submitCivilCalculation(input, selector, location, key, queue);
  assert.equal(result.status, 'submitted');
  assert.equal(latReads, 1);
  assert.equal(lngReads, 1);
  assert.deepEqual([drafts[0].latMicro, drafts[0].lngMicro], [43_769_560, 11_255_810]);
});

test('selector side effects cannot alter the already validated location submitted to queue', () => {
  const location = {latMicro: 43_769_560, lngMicro: 11_255_810};
  const drafts = [];
  const result = submitCivilCalculation(input, () => {
    location.latMicro = 100_000_000;
    location.lngMicro = Number.NaN;
    return validChoice;
  }, location, key, {submit(draft) { drafts.push(draft); return 7; }});
  assert.equal(result.status, 'submitted');
  assert.equal(result.requestSeq, 7);
  assert.deepEqual([drafts[0].latMicro, drafts[0].lngMicro], [43_769_560, 11_255_810]);
});

test('throwing coordinate getters reject safely before selector or queue effects', () => {
  for (const field of ['latMicro', 'lngMicro']) {
    let resolverCalls = 0, queueCalls = 0;
    const location = {
      get latMicro() { if (field === 'latMicro') throw new Error('private coordinate'); return 0; },
      get lngMicro() { if (field === 'lngMicro') throw new Error('private coordinate'); return 0; },
    };
    const result = submitCivilCalculation(input, () => { resolverCalls++; return validChoice; },
      location, key, {submit() { queueCalls++; return 1; }});
    assert.deepEqual(result, {status:'location_invalid'});
    assert.equal(resolverCalls, 0);
    assert.equal(queueCalls, 0);
  }
});

test('later accessor values cannot replace an invalid first read', () => {
  let calls = 0, selectionCalls = 0, queueCalls = 0;
  const location = {
    get latMicro() { return ++calls === 1 ? 90_000_001 : 0; },
    lngMicro:0,
  };
  const result = submitCivilCalculation(input, () => { selectionCalls++; return validChoice; },
    location, key, {submit() { queueCalls++; return 1; }});
  assert.deepEqual(result, {status:'location_invalid'});
  assert.equal(calls, 1);
  assert.equal(selectionCalls, 0);
  assert.equal(queueCalls, 0);
});
