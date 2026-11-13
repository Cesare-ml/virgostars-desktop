import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UI_PREFERENCES_KEY, DEFAULT_UI_PREFERENCES, browserUiPreferencesStorage,
  loadUiPreferences, saveUiPreferences
} from '../src/app/ui-preferences.ts';

const fakeStorage = (initial = null) => {
  let value = initial;
  return {
    getItem(key) { assert.equal(key,UI_PREFERENCES_KEY); return value; },
    setItem(key, next) { assert.equal(key,UI_PREFERENCES_KEY); value = next; },
    raw() { return value; },
  };
};

test('fresh guest sessions default to light mode and Italian without network or login',()=>{
  assert.deepEqual(loadUiPreferences(null),DEFAULT_UI_PREFERENCES);
  assert.deepEqual(loadUiPreferences(fakeStorage()),{theme:'light',locale:'it'});
  assert.equal(browserUiPreferencesStorage(),null); // Node has no WebView
});

test('light/dark and Italian/English survive a new reader through a versioned device-only value',()=>{
  const store=fakeStorage();
  assert.equal(saveUiPreferences(store,{theme:'dark',locale:'en'}),true);
  assert.deepEqual(JSON.parse(store.raw()),{version:1,theme:'dark',locale:'en'});
  assert.deepEqual(loadUiPreferences(store),{theme:'dark',locale:'en'});
  assert.equal(saveUiPreferences(store,{theme:'light',locale:'it'}),true);
  assert.deepEqual(loadUiPreferences(store),{theme:'light',locale:'it'});
});

test('unknown, malformed and excessively long contents fail closed to defaults',()=>{
  for(const raw of ['{broken','null','[]','{"version":2,"theme":"dark","locale":"en"}',
    '{"version":1,"theme":"__proto__","locale":"xx"}', 'a'.repeat(513)]) {
    assert.deepEqual(loadUiPreferences(fakeStorage(raw)),DEFAULT_UI_PREFERENCES);
  }
});

test('valid preferences survive one corrupt field; no arbitrary string is exposed to Angular',()=>{
  const state={version:1,theme:'dark',locale:'<script>alert(1)</script>'};
  assert.deepEqual(loadUiPreferences(fakeStorage(JSON.stringify(state))),{theme:'dark',locale:'it'});
  assert.deepEqual(loadUiPreferences(fakeStorage(JSON.stringify({version:1,theme:false,locale:'en'}))),
    {theme:'light',locale:'en'});
});

test('denied reads and writes never throw or block the app',()=>{
  const broken={getItem(){throw new Error('blocked');},setItem(){throw new Error('quota');}};
  assert.deepEqual(loadUiPreferences(broken),DEFAULT_UI_PREFERENCES);
  assert.equal(saveUiPreferences(broken,{theme:'dark',locale:'en'}),false);
  assert.equal(saveUiPreferences(null,{theme:'dark',locale:'en'}),false);
});

test('persistence allowlists ONLY UI appearance/language, never birth records, places or tokens',()=>{
  const store=fakeStorage();
  const unsafe={theme:'dark',locale:'it',birthDate:'2000-01-01',city:'SECRET',accessToken:'SECRET'};
  assert.equal(saveUiPreferences(store,unsafe),true);
  assert.deepEqual(Object.keys(JSON.parse(store.raw())).sort(),['locale','theme','version']);
  assert.equal(saveUiPreferences(store,{theme:'solar',locale:'en'}),false);
  assert.equal(saveUiPreferences(store,{theme:'light',locale:'it-IT'}),false);
});
