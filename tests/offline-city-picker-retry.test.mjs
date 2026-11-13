import test from 'node:test';
import assert from 'node:assert/strict';
import {OfflineCityPickerState} from '../src/app/offline-city-picker-state.ts';

const city = Object.freeze({id: 9, name: 'Fictional', italianName: null, latMicro: 2,
  lngMicro: 3, population: null, stateId: null, region: null,
  timeZone: 'Etc/UTC', countryName: null, countryCode: null});
function harness() {
  const pending = [], timers = new Map();
  let id = 0, calls = 0, notices = 0;
  const lookup = {
    clear() {},
    search() { calls++; return new Promise((resolve, reject) => pending.push({resolve, reject})); },
  };
  const clock = {
    set(fn) { const key = ++id; timers.set(key, fn); return key; },
    clear(key) { timers.delete(key); },
  };
  const state = new OfflineCityPickerState(lookup, () => {notices++;}, clock);
  return {state, pending, timers, flush() {const fns = [...timers.values()]; timers.clear(); fns.forEach(fn => fn());},
    get calls() {return calls;}, get notices() {return notices;}};
}

test('busy state supports one manual debounced retry and successful recovery', async () => {
  const h = harness();
  h.state.input('Fictional'); h.flush();
  h.pending[0].resolve({kind: 'busy', items: []}); await Promise.resolve();
  assert.equal(h.state.status, 'busy');
  assert.equal(h.state.retry(), true);
  assert.equal(h.state.status, 'typing');
  assert.equal(h.calls, 1);
  assert.equal(h.timers.size, 1);
  h.flush(); assert.equal(h.calls, 2);
  h.pending[1].resolve({kind: 'ready', items: [city]}); await Promise.resolve();
  assert.equal(h.state.status, 'ready');
  assert.deepEqual(h.state.results, [city]);
});

test('generic unavailable state supports explicit retry without leaking details', async () => {
  const h = harness();
  h.state.input('Fictional'); h.flush();
  h.pending[0].reject(new Error('hidden/private/location')); await Promise.resolve();
  assert.equal(h.state.status, 'unavailable');
  assert.equal(h.state.retry(), true);
  h.flush();
  h.pending[1].resolve({kind: 'ready', items: []}); await Promise.resolve();
  assert.equal(h.state.status, 'empty');
});

test('idle, selected and non-transient failures never retry', async () => {
  const h = harness();
  assert.equal(h.state.retry(), false);
  h.state.restore(city);
  assert.equal(h.state.retry(), false);
  h.state.input('Fictional'); h.flush();
  h.pending[0].resolve({kind: 'catalog_unavailable', items: []}); await Promise.resolve();
  assert.equal(h.state.retry(), false);
  assert.equal(h.calls, 1);
  assert.equal(h.timers.size, 0);
});

test('retry invalidates late results from the previous query', async () => {
  const h = harness();
  h.state.input('Fictional'); h.flush();
  h.pending[0].resolve({kind: 'stale', items: []}); await Promise.resolve();
  assert.equal(h.state.status, 'busy');
  h.state.retry(); h.flush();
  h.state.input('Fictiona'); h.flush();
  h.pending[2].resolve({kind: 'ready', items: [city]}); await Promise.resolve();
  h.pending[1].resolve({kind: 'ready', items: []}); await Promise.resolve();
  assert.equal(h.state.status, 'ready');
  assert.equal(h.state.results[0]?.id, 9);
});

test('disposed picker does not retry, schedule work or publish notifications', async () => {
  const h = harness();
  h.state.input('Fictional'); h.flush();
  h.pending[0].resolve({kind: 'unavailable', items: []}); await Promise.resolve();
  h.state.dispose();
  const notices = h.notices;
  assert.equal(h.state.retry(), false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.notices, notices);
});
