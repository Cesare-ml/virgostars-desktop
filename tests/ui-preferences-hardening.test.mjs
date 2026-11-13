import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_UI_PREFERENCES,
  UI_PREFERENCES_KEY,
  loadUiPreferences,
  saveUiPreferences,
} from '../src/app/ui-preferences.ts';

function memoryStorage() {
  let value = null;
  return {
    getItem(key) { assert.equal(key, UI_PREFERENCES_KEY); return value; },
    setItem(key, next) { assert.equal(key, UI_PREFERENCES_KEY); value = next; },
    raw() { return value; },
  };
}

test('preference fields are snapshotted once before writing an allowlisted payload', () => {
  const storage = memoryStorage();
  let reads = 0;
  const input = {
    get theme() { reads++; return reads === 1 ? 'dark' : 'untrusted'; },
    locale: 'en',
    privateSubject: 'must-never-be-serialized',
  };
  assert.equal(saveUiPreferences(storage, input), true);
  assert.equal(reads, 1);
  assert.deepEqual(JSON.parse(storage.raw()), {version: 1, theme: 'dark', locale: 'en'});
  assert.deepEqual(loadUiPreferences(storage), {theme: 'dark', locale: 'en'});
});

test('throwing preference getters do not interrupt the app or write partial state', () => {
  const storage = memoryStorage();
  const dangerous = {
    get theme() { throw new Error('sensitive getter failure'); },
    locale: 'it',
  };
  assert.equal(saveUiPreferences(storage, dangerous), false);
  assert.equal(storage.raw(), null);
  assert.deepEqual(loadUiPreferences(storage), DEFAULT_UI_PREFERENCES);
});

test('invalid or missing preference values never access storage', () => {
  let writes = 0;
  const storage = {getItem() { return null; }, setItem() { writes++; }};
  for (const value of [null, undefined, {}, {theme: 'solar', locale: 'it'}, {theme: 'dark', locale: null}]) {
    assert.equal(saveUiPreferences(storage, value), false);
  }
  assert.equal(writes, 0);
});

test('throwing storage accessors are contained after valid preference snapshot', () => {
  const storage = {getItem() { return null; }, get setItem() { throw new Error('blocked by WebView'); }};
  assert.equal(saveUiPreferences(storage, {theme: 'dark', locale: 'en'}), false);
});
