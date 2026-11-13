import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OfflineCityPickerState} from '../src/app/offline-city-picker-state.ts';

const place = Object.freeze({
  id: 101, name: 'Springfield', italianName: null, latMicro: 1_000_000,
  lngMicro: 2_000_000, population: null, stateId: 9,
  region: 'Fictional Region', timeZone: 'Etc/UTC',
  countryName: 'Fictional Country', countryCode: 'FC',
});
function fixture() {
  const timers = new Map();
  const pending = [];
  let next = 0, cleared = 0, changed = 0;
  const lookup = {
    clear: () => { cleared++; },
    search: () => new Promise((resolve, reject) => pending.push({resolve, reject})),
  };
  const clock = {
    set: (fn) => { const id = ++next; timers.set(id, fn); return id; },
    clear: (id) => { timers.delete(id); },
  };
  const state = new OfflineCityPickerState(lookup, () => { changed++; }, clock);
  return {
    state, pending, timers,
    fire() { const scheduled = [...timers.values()]; timers.clear(); scheduled.forEach(fn => fn()); },
    get cleared() { return cleared; }, get changed() { return changed; },
  };
}

test('clear selected location removes all temporary selection and query state', () => {
  const h = fixture();
  h.state.restore(place);
  assert.equal(h.state.status, 'selected');
  const notified = h.changed, cancelled = h.cleared;
  h.state.clearSelection();
  assert.equal(h.state.selected, null);
  assert.equal(h.state.query, '');
  assert.deepEqual(h.state.results, []);
  assert.equal(h.state.activeIndex, -1);
  assert.equal(h.state.status, 'idle');
  assert.equal(h.changed, notified + 1);
  assert.equal(h.cleared, cancelled + 1);
});

test('clearing a pending search prevents a late native response restoring the city', async () => {
  const h = fixture();
  h.state.input('Spring'); h.fire();
  assert.equal(h.state.status, 'loading');
  h.state.clearSelection();
  h.pending[0].resolve({kind: 'ready', items: [place]});
  await Promise.resolve();
  assert.equal(h.state.selected, null);
  assert.deepEqual(h.state.results, []);
  assert.equal(h.state.status, 'idle');
});

test('clear cancels a debounced but not yet dispatched search', () => {
  const h = fixture();
  h.state.input('Spring');
  assert.equal(h.timers.size, 1);
  h.state.clearSelection(); h.fire();
  assert.equal(h.pending.length, 0);
  assert.equal(h.state.query, '');
});

test('clear cannot revive a destroyed city picker', () => {
  const h = fixture();
  h.state.restore(place);
  h.state.dispose();
  const old = h.changed;
  h.state.clearSelection();
  assert.equal(h.changed, old);
  assert.equal(h.state.selected, place);
});

test('Angular selection clear is accessible and notifies parent while preserving identity details', () => {
  const component = readFileSync(new URL('../src/app/offline-city-picker.component.ts', import.meta.url), 'utf8');
  const template = readFileSync(new URL('../src/app/offline-city-picker.component.html', import.meta.url), 'utf8');
  const translations = readFileSync(new URL('../src/app/translations.ts', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../src/app/desktop-app.component.html', import.meta.url), 'utf8');
  assert.match(component, /clearSelected\(\): void\s*\{[\s\S]*?this\.state\.clearSelection\(\);[\s\S]*?this\.locationEdited\.emit\(\)/);
  assert.match(component, /place\.region,\s*place\.countryName,\s*place\.timeZone/);
  assert.match(template, /\[attr\.aria-label\]="t\('city\.clear'\)"/);
  assert.match(template, /\(click\)="clearSelected\(\)"/);
  assert.match(template, /\{\{place\.name\}\}/);
  const parent = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');
  assert.match(shell, /\(locationEdited\)="onCityEdited\(\)"/);
  assert.match(parent, /onCityEdited\(\): void\s*\{\s*this\.selectedCity = null;\s*this\.updateCityClock\(\);/);
  assert.equal((translations.match(/"city\.clear":/g) || []).length, 2);
});
