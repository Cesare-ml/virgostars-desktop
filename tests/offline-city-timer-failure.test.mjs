import test from 'node:test';
import assert from 'node:assert/strict';
import {OfflineCityPickerState} from '../src/app/offline-city-picker-state.ts';

const city = Object.freeze({
  id: 10, name: 'Fictional Town', italianName: null,
  latMicro: 1_000_000, lngMicro: 2_000_000, population: null,
  stateId: null, region: null, timeZone: 'Etc/UTC',
  countryName: null, countryCode: null,
});

test('a throwing scheduler settles into unavailable and manual retry can recover', async () => {
  let schedules = 0, pending = null, searches = 0, notifications = 0;
  const timers = {
    set(callback) {
      schedules++;
      if (schedules === 1) throw new Error('do not display scheduler internals');
      pending = callback;
      return 0;
    },
    clear(handle) { assert.equal(handle, 0); pending = null; },
  };
  const state = new OfflineCityPickerState({
    search: async () => { searches++; return {kind:'ready', items:[city]}; },
    clear() {},
  }, () => notifications++, timers);
  assert.doesNotThrow(() => state.input('Fictional'));
  assert.equal(state.status, 'unavailable');
  assert.equal(schedules, 1);
  assert.equal(searches, 0);
  assert.equal(notifications, 1);
  assert.equal(state.retry(), true);
  assert.equal(state.status, 'typing');
  assert.equal(schedules, 2);
  pending();
  await Promise.resolve();
  assert.equal(state.status, 'ready');
  assert.equal(state.results[0].id, 10);
  assert.equal(searches, 1);
  state.dispose();
});

test('missing debounce handle is unavailable, while zero is a valid handle', async () => {
  let callback = null, attempt = 0;
  const timers = {
    set(fn) { attempt++; callback = fn; return attempt === 1 ? undefined : 0; },
    clear(id) { assert.equal(id, 0); callback = null; },
  };
  const state = new OfflineCityPickerState({
    search: async () => ({kind:'ready', items:[]}),
    clear() {},
  }, () => {}, timers);
  state.input('Fictional');
  assert.equal(state.status, 'unavailable');
  assert.equal(state.retry(), true);
  assert.equal(state.status, 'typing');
  callback();
  await Promise.resolve();
  assert.equal(state.status, 'empty');
  state.dispose();
});

test('throwing timer clear does not prevent a city clear or revive stale search', async () => {
  let scheduled, resolve;
  const timers = {
    set(fn) { scheduled = fn; return 0; },
    clear() { throw new Error('private platform timer details'); },
  };
  const state = new OfflineCityPickerState({
    search: () => new Promise(done => {resolve = done;}),
    clear() {},
  }, () => {}, timers);
  state.input('Fictional');
  const staleCallback = scheduled;
  assert.doesNotThrow(() => state.clearSelection());
  staleCallback();
  assert.equal(resolve, undefined, 'cancel failure cannot dispatch an invalidated debounce');
  assert.equal(state.status, 'idle');
  assert.deepEqual(state.results, []);
  state.dispose();
});

test('throwing native lookup clear cannot block explicit forget or cancellation', async () => {
  let callback, resolve;
  const timers = {set(fn) { callback = fn; return 0; }, clear() {}};
  const state = new OfflineCityPickerState({
    search: () => new Promise(done => {resolve = done;}),
    clear() { throw new Error('private native scope internals'); },
  }, () => {}, timers);
  assert.doesNotThrow(() => state.input('Fictional'));
  callback();
  assert.equal(state.status, 'loading');
  assert.doesNotThrow(() => state.clearSelection());
  resolve({kind:'ready', items:[city]});
  await Promise.resolve();
  assert.equal(state.status, 'idle');
  assert.equal(state.selected, null);
  assert.deepEqual(state.results, []);
  assert.doesNotThrow(() => state.dispose());
});

test('a scheduler failure cannot preserve a previously selected place', () => {
  const state = new OfflineCityPickerState({
    search: async () => ({kind:'ready', items:[]}),
    clear() {},
  }, () => {}, {
    set() { throw new Error('private'); },
    clear() {},
  });
  state.restore(city);
  state.input('Imaginary');
  assert.equal(state.selected, null);
  assert.equal(state.query, 'Imaginary');
  assert.equal(state.status, 'unavailable');
  assert.equal(state.retry(), true);
  assert.equal(state.status, 'unavailable');
  assert.deepEqual(state.results, []);
});
