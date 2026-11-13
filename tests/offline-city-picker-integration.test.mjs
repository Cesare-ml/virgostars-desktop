import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OfflineCityPickerState} from '../src/app/offline-city-picker-state.ts';
import {OfflinePlaceSearch} from '../src/app/native/offline-places-contract.ts';

const fictional = Object.freeze({
  id: 321, name: 'Imaginary Town', italianName: null,
  latMicro: 1000000, lngMicro: 2000000, population: null,
  stateId: null, region: 'Test Region', timeZone: 'Etc/UTC',
  countryName: 'Test Country', countryCode: 'TC',
});

function makePicker(lookup) {
  const jobs = new Map();
  let index = 0, changes = 0;
  const clock = {
    set(callback) { jobs.set(++index, callback); return index; },
    clear(key) { jobs.delete(key); },
  };
  const state = new OfflineCityPickerState(lookup, () => {changes++;}, clock);
  return {
    state, jobs,
    tick() {
      const callbacks = [...jobs.values()];
      jobs.clear();
      callbacks.forEach(fn => fn());
    },
    get changes() { return changes; },
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('Unicode input clipping preserves 80 complete code points and valid native requests', async () => {
  const requests = [];
  const lookup = new OfflinePlaceSearch({
    isNative: () => true,
    invoke: async (_command, args) => {
      requests.push(args.query);
      return {protocolVersion: 1, items: []};
    },
  });
  const p = makePicker(lookup);
  p.state.input('𝔸'.repeat(81));
  assert.equal([...p.state.query].length, 80);
  assert.equal(p.state.query, '𝔸'.repeat(80));
  p.tick();
  await flush();
  assert.deepEqual(requests, ['𝔸'.repeat(80)]);
  assert.equal(p.state.status, 'empty');
});

test('clearing one scoped picker does not cancel an unrelated active picker', async () => {
  const deferred = [];
  function independentLookup(name) {
    return new OfflinePlaceSearch({
      isNative: () => true,
      invoke: () => new Promise(resolve => deferred.push({name, resolve})),
    });
  }
  const first = makePicker(independentLookup('first'));
  const second = makePicker(independentLookup('second'));
  first.state.input('Imaginary'); second.state.input('Imaginary');
  first.tick(); second.tick();
  assert.deepEqual(deferred.map(x => x.name), ['first', 'second']);
  first.state.clearSelection();
  deferred[1].resolve({protocolVersion: 1, items: [fictional]});
  deferred[0].resolve({protocolVersion: 1, items: [fictional]});
  await flush();
  assert.equal(first.state.selected, null);
  assert.equal(first.state.status, 'idle');
  assert.deepEqual(first.state.results, []);
  assert.equal(second.state.status, 'ready');
  assert.equal(second.state.results[0]?.id, fictional.id);
});

test('a current stale native status becomes retryable busy, then new input recovers', async () => {
  let next = {kind: 'stale', items: []};
  const lookup = {search: async () => next, clear: () => {}};
  const p = makePicker(lookup);
  p.state.input('Imaginary'); p.tick();
  await flush();
  assert.equal(p.state.status, 'busy');
  next = {kind: 'ready', items: [fictional]};
  p.state.input('Imaginary'); p.tick();
  await flush();
  assert.equal(p.state.status, 'ready');
  assert.equal(p.state.chooseActive(), null);
  assert.equal(p.state.choose(0)?.id, fictional.id);
});

test('removing a restored city drops metadata, selection and query without native calls', () => {
  let invoked = 0;
  const p = makePicker({search: async () => {invoked++; return {kind:'ready', items:[]};}, clear(){}});
  p.state.restore(fictional);
  assert.equal(p.state.selected?.countryCode, 'TC');
  p.state.clearSelection(); p.tick();
  assert.equal(p.state.selected, null);
  assert.equal(p.state.query, '');
  assert.deepEqual(p.state.results, []);
  assert.equal(p.state.status, 'idle');
  assert.equal(invoked, 0);
});

test('destroyed picker suppresses late native results even after a clear attempt', async () => {
  let resolve;
  const lookup = new OfflinePlaceSearch({
    isNative: () => true,
    invoke: () => new Promise(done => {resolve = done;}),
  });
  const p = makePicker(lookup);
  p.state.input('Imaginary'); p.tick();
  const old = p.changes;
  p.state.dispose();
  p.state.clearSelection();
  resolve({protocolVersion: 1, items: [fictional]});
  await flush();
  assert.equal(p.changes, old);
  assert.equal(p.state.status, 'loading'); // retired state does not emit a false ready status
  assert.deepEqual(p.state.results, []);
});

test('combined Angular wiring preserves scoped lookup, explicit clear and bilingual accessibility', () => {
  const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  const component = read('src/app/offline-city-picker.component.ts');
  const template = read('src/app/offline-city-picker.component.html');
  const state = read('src/app/offline-city-picker-state.ts');
  const bridge = read('src/app/native/offline-places-contract.ts');
  const adapter = read('src/app/native/offline-places.ts');
  const strings = read('src/app/translations.ts');
  const shell = read('src/app/desktop-app.component.html');
  assert.match(component, /new OfflineCityPickerState\(createOfflinePlaceSearch\(\),/);
  assert.match(adapter, /export function createOfflinePlaceSearch\(\): OfflinePlaceSearch/);
  assert.match(component, /this\.state\.clearSelection\(\);[\s\S]*?this\.locationEdited\.emit\(\)/);
  assert.match(template, /\(click\)="clearSelected\(\)"/);
  assert.match(template, /\[attr\.aria-label\]="t\('city\.clear'\)"/);
  assert.match(template, /maxlength="160"/);
  assert.match(component, /if \(input\.value !== this\.state\.query\) input\.value = this\.state\.query/);
  assert.equal((strings.match(/"city\.clear":/g)||[]).length, 2);
  assert.match(shell, /\(locationEdited\)="selectedCity = null"/);
  assert.match(state, /\[\.\.\.value\]\.slice\(0, 80\)\.join\(''\)/);
  assert.match(state, /result\.kind === 'stale' \? 'busy'/);
  assert.match(bridge, /if \(items\.length > limit\) return \{kind: 'unavailable', items: \[\]\}/);
  assert.doesNotMatch(bridge, /String\(error\)/);
  assert.match(state, /retry\(\): boolean/);
  assert.match(component, /retry\(input: HTMLInputElement\): void/);
  assert.match(component, /if \(this\.state\.retry\(\)\) input\.focus\(\)/);
  assert.match(template, /\*ngIf="state\.status === 'busy' \|\| state\.status === 'unavailable'"/);
  assert.match(template, /\(click\)="retry\(citySearchInput\)"/);
  assert.equal((strings.match(/"city\.retry":/g)||[]).length, 2);
});
