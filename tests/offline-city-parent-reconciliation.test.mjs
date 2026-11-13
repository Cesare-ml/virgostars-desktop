import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  OfflineCityPickerState, reconcileParentCitySelection,
} from '../src/app/offline-city-picker-state.ts';
import {selectedCityClockAt} from '../src/app/device-clock.ts';

const florence = Object.freeze({
  id: 10, name: 'Firenze', italianName: null, latMicro: 43_770_000,
  lngMicro: 11_250_000, population: null, stateId: 1, region: 'Toscana',
  timeZone: 'Europe/Rome', countryName: 'Italia', countryCode: 'IT',
});
const other = Object.freeze({...florence, id: 11, name: 'Roma'});

function harness() {
  const pending = [], tasks = new Map();
  let serial = 0, notifications = 0, cancellations = 0;
  const lookup = {
    clear() { cancellations++; },
    search(query, limit) {
      return new Promise(resolve => pending.push({query, limit, resolve}));
    },
  };
  const timers = {
    set(fn) { const id = ++serial; tasks.set(id, fn); return id; },
    clear(id) { tasks.delete(id); },
  };
  const state = new OfflineCityPickerState(lookup, () => notifications++, timers);
  return {
    state, tasks, pending,
    get notifications() { return notifications; },
    get cancellations() { return cancellations; },
    flush() { const fns = [...tasks.values()]; tasks.clear(); fns.forEach(fn => fn()); },
  };
}

test('external parent clear retires selected city and civil clock without event feedback', () => {
  const h = harness();
  reconcileParentCitySelection(h.state, florence);
  assert.equal(h.state.selected?.id, 10);
  const instant = Date.parse('2026-11-13T17:20:30Z');
  assert.equal(selectedCityClockAt(instant, h.state.selected, 'it').kind, 'ready');
  const before = h.notifications;
  reconcileParentCitySelection(h.state, null);
  assert.equal(h.state.selected, null);
  assert.equal(h.state.query, '');
  assert.equal(h.state.status, 'idle');
  assert.equal(h.notifications, before + 1);
  assert.deepEqual(selectedCityClockAt(instant, h.state.selected, 'it'), {kind: 'not_selected'});
});

test('external parent null preserves active user query and its pending debounce', async () => {
  const h = harness();
  reconcileParentCitySelection(h.state, florence);
  h.state.input('Bologn');
  assert.equal(h.state.selected, null);
  assert.equal(h.state.status, 'typing');
  assert.equal(h.tasks.size, 1);
  const before = h.notifications;
  const cleared = h.cancellations;
  reconcileParentCitySelection(h.state, null);
  assert.equal(h.state.query, 'Bologn');
  assert.equal(h.state.status, 'typing');
  assert.equal(h.tasks.size, 1);
  assert.equal(h.notifications, before);
  assert.equal(h.cancellations, cleared);
  h.flush();
  assert.equal(h.pending.length, 1);
  assert.deepEqual([h.pending[0].query, h.pending[0].limit], ['Bologn', 12]);
  h.pending[0].resolve({kind: 'ready', items: [other]});
  await Promise.resolve();
  assert.equal(h.state.status, 'ready');
  assert.equal(h.state.results[0].id, other.id);
});

test('external parent switch invalidates earlier asynchronous results', async () => {
  const h = harness();
  h.state.input('Roma');
  h.flush();
  assert.equal(h.pending.length, 1);
  reconcileParentCitySelection(h.state, florence);
  assert.equal(h.state.selected?.id, florence.id);
  h.pending[0].resolve({kind: 'ready', items: [other]});
  await Promise.resolve();
  assert.equal(h.state.status, 'selected');
  assert.equal(h.state.selected?.id, florence.id);
  assert.deepEqual(h.state.results, []);
});

test('no parent update is needed when both parent and picker are already empty', () => {
  const h = harness();
  reconcileParentCitySelection(h.state, null);
  assert.equal(h.notifications, 0);
  assert.equal(h.cancellations, 0);
  assert.equal(h.state.status, 'idle');
  h.state.dispose();
  reconcileParentCitySelection(h.state, null);
  assert.equal(h.notifications, 0);
});

test('component only reconciles actual selectedPlace input changes without emitting outputs', () => {
  const src = readFileSync(new URL('../src/app/offline-city-picker.component.ts', import.meta.url), 'utf8');
  const match = src.match(/ngOnChanges\(changes: SimpleChanges\): void \{([\s\S]*?)\n  \}/);
  assert.ok(match, 'must preserve Angular ngOnChanges lifecycle');
  assert.match(match[1], /changes\['selectedPlace'\]/);
  assert.match(match[1], /reconcileParentCitySelection\(this\.state, this\.selectedPlace\)/);
  assert.doesNotMatch(match[1], /locationEdited\.emit\(|locationSelected\.emit\(/);
  assert.match(src, /readonly state = new OfflineCityPickerState\(createOfflinePlaceSearch\(\),/);
});
