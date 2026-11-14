import test from 'node:test';
import assert from 'node:assert/strict';
import {OfflineCityPickerState} from '../src/app/offline-city-picker-state.ts';

const city = Object.freeze({
  id: 1, name: 'Firenze', italianName: null, latMicro: 43769560,
  lngMicro: 11255810, population: 360000, stateId: 1,
  region: 'Toscana', timeZone: 'Europe/Rome', countryName: 'Italia', countryCode: 'IT',
});

function harness(changed = () => { throw new Error('synthetic observer failure'); }) {
  const callbacks = new Map();
  const lookups = [];
  let id = 0;
  const lookup = {
    clear() {},
    async search(query, limit) {
      lookups.push([query, limit]);
      return {kind:'ready', items:[city]};
    },
  };
  const timers = {
    set(callback) { callbacks.set(++id, callback); return id; },
    clear(handle) { callbacks.delete(handle); },
  };
  const state = new OfflineCityPickerState(lookup, changed, timers);
  return {state, callbacks, lookups, fire() {
    const pending = [...callbacks.values()];
    callbacks.clear();
    for (const callback of pending) callback();
  }};
}

test('throwing input and loading observers cannot block a valid search', async () => {
  const h = harness();
  assert.doesNotThrow(() => h.state.input('Firenze'));
  assert.equal(h.state.status, 'typing');
  h.fire();
  await Promise.resolve();
  assert.deepEqual(h.lookups, [['Firenze', 12]]);
  assert.equal(h.state.status, 'ready');
  assert.deepEqual(h.state.results, [city]);
  h.state.dispose();
});

test('throwing observer does not block keyboard navigation or city selection', async () => {
  const h = harness();
  h.state.input('Firenze');
  h.fire(); await Promise.resolve();
  assert.doesNotThrow(() => h.state.move(1));
  assert.equal(h.state.activeIndex, 0);
  const selected = h.state.chooseActive();
  assert.strictEqual(selected, city);
  assert.strictEqual(h.state.selected, city);
  assert.equal(h.state.status, 'selected');
  assert.equal(h.state.results.length, 0);
  h.state.dispose();
});

test('restore and dismiss remain safe if UI is already tearing down', () => {
  const h = harness();
  assert.doesNotThrow(() => h.state.restore(city));
  assert.equal(h.state.status, 'selected');
  assert.doesNotThrow(() => h.state.dismiss());
  assert.equal(h.state.status, 'selected');
  assert.doesNotThrow(() => h.state.input('Roma'));
  assert.doesNotThrow(() => h.state.dismiss());
  assert.equal(h.state.status, 'idle');
  h.fire();
  assert.deepEqual(h.lookups, []);
  h.state.dispose();
});

test('reentrant loading observer still retires obsolete search when it throws', async () => {
  let state;
  let reentered = false;
  const h = harness(() => {
    if (!reentered && state.status === 'loading') {
      reentered = true;
      state.input('Firenze');
      throw new Error('observer reentered and failed');
    }
  });
  state = h.state;
  state.input('Roma');
  h.fire();
  assert.equal(state.query, 'Firenze');
  assert.equal(state.status, 'typing');
  assert.deepEqual(h.lookups, [], 'retired Roma search must not run');
  h.fire();
  await Promise.resolve();
  assert.deepEqual(h.lookups, [['Firenze', 12]]);
  assert.equal(state.status, 'ready');
  state.dispose();
});

test('dispose after a throwing observer prevents obsolete completion', async () => {
  let resolveLookup;
  let calls = 0;
  const state = new OfflineCityPickerState(
    { clear() {}, search() { return new Promise(resolve => { resolveLookup = resolve; }); } },
    () => { calls++; throw new Error('observer failed'); },
    {set(fn) { fn(); return 1; }, clear() {}},
  );
  assert.doesNotThrow(() => state.input('Firenze'));
  const before = calls;
  state.dispose();
  resolveLookup({kind:'ready', items:[city]});
  await Promise.resolve();
  assert.equal(calls, before);
  assert.equal(state.results.length, 0);
});
