import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DeviceClock, selectedCityClockAt} from '../src/app/device-clock.ts';
import {OfflineCityPickerState} from '../src/app/offline-city-picker-state.ts';
import {STRINGS} from '../src/app/translations.ts';

const place = Object.freeze({
  id: 1, name: 'Firenze', italianName: 'Firenze',
  latMicro: 43769560, lngMicro: 11255810, population: 360000,
  stateId: 1, region: 'Toscana', timeZone: 'Europe/Rome',
  countryName: 'Italia', countryCode: 'IT',
});
const utc = Date.parse('2026-11-13T17:20:30Z');

function harness() {
  let timer = null;
  let timerId = 0;
  let changes = 0;
  const requests = [];
  const lookup = {
    search(query, limit) {
      return new Promise(resolve => requests.push({query, limit, resolve}));
    },
    clear() {},
  };
  const timers = {
    set(fn) { timer = fn; return ++timerId; },
    clear() { timer = null; },
  };
  const state = new OfflineCityPickerState(lookup, () => changes++, timers);
  return {state, requests, get changes() { return changes; },
    fire() { const cb = timer; timer = null; cb?.(); }};
}

test('choosing and clearing an offline city changes only the clock preview', () => {
  const h = harness();
  h.state.restore(place);
  const italian = selectedCityClockAt(utc, h.state.selected, 'it');
  assert.equal(italian.kind, 'ready');
  assert.equal(italian.timeZone, 'Europe/Rome');
  assert.match(italian.text, /18:20:30/);
  assert.match(selectedCityClockAt(utc, h.state.selected, 'en').text, /18:20:30/);
  h.state.clearSelection();
  assert.equal(h.state.selected, null);
  assert.equal(h.state.status, 'idle');
  assert.deepEqual(selectedCityClockAt(utc, h.state.selected, 'it'), {kind:'not_selected'});
});

test('clear after in-flight lookup cannot resurrect the clock city', async () => {
  const h = harness();
  h.state.restore(place);
  h.state.input('Roma');
  h.fire();
  assert.deepEqual([h.requests[0].query, h.requests[0].limit], ['Roma', 12]);
  h.state.clearSelection();
  h.requests[0].resolve({kind:'ready', items:[place]});
  await Promise.resolve();
  assert.equal(h.state.selected, null);
  assert.equal(h.state.query, '');
  assert.deepEqual(h.state.results, []);
  assert.equal(h.state.status, 'idle');
  assert.deepEqual(selectedCityClockAt(utc, h.state.selected, 'en'), {kind:'not_selected'});
});

test('invalid device clock invalidates a selected-city preview and recovers', () => {
  let now = utc;
  let tick = null;
  const clock = new DeviceClock({
    now: () => now,
    schedule: fn => { tick = fn; return 0; },
    cancel: () => { tick = null; },
  });
  let notifications = 0;
  clock.start(() => notifications++);
  assert.equal(selectedCityClockAt(clock.timestamp, place, 'it').kind, 'ready');
  now = NaN; tick();
  assert.deepEqual(selectedCityClockAt(clock.timestamp, place, 'it'), {kind:'unavailable'});
  assert.equal(notifications, 1);
  now = utc + 1_000; tick();
  assert.equal(selectedCityClockAt(clock.timestamp, place, 'it').kind, 'ready');
  assert.equal(notifications, 2);
  clock.dispose();
});

test('merged dictionaries retain preferences/clock labels and clear/retry in both locales', () => {
  assert.deepEqual(Object.keys(STRINGS.it).sort(), Object.keys(STRINGS.en).sort());
  for (const locale of ['it','en']) {
    for (const key of ['city.clear','city.retry','clock.city','clock.city.unavailable',
      'settings.help','theme.light','theme.dark']) {
      assert.equal(typeof STRINGS[locale][key], 'string');
      assert.ok(STRINGS[locale][key].length > 0);
    }
  }
  assert.match(STRINGS.it['settings.help'], /salvati/);
  assert.match(STRINGS.en['settings.help'], /device/);
});

test('desktop clear event is wired to parent selected city and clock reset', () => {
  const parent = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url),'utf8');
  const view = readFileSync(new URL('../src/app/desktop-app.component.html', import.meta.url),'utf8');
  const picker = readFileSync(new URL('../src/app/offline-city-picker.component.ts', import.meta.url),'utf8');
  assert.match(parent, /onCityEdited\(\): void\s*\{\s*this\.selectedCity = null;\s*this\.updateCityClock\(\);/);
  assert.match(view, /\(locationEdited\)="onCityEdited\(\)"/);
  assert.match(picker, /clearSelected\(\): void\s*\{[\s\S]*?this\.state\.clearSelection\(\);\s*this\.locationEdited\.emit\(\);/);
  assert.match(picker, /new OfflineCityPickerState\(createOfflinePlaceSearch\(\),/);
});
