import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_INSPECTOR_TAB, INSPECTOR_TAB_KEY, isInspectorTab, loadInspectorTab, saveInspectorTab} from '../src/app/inspector-tab-preference.ts';

function memoryStorage(initial = null) {
  let value = initial;
  const writes = [];
  return {
    getItem(key) { assert.equal(key,INSPECTOR_TAB_KEY); return value; },
    setItem(key,next) { assert.equal(key,INSPECTOR_TAB_KEY); writes.push(next); value=next; },
    get raw() { return value; },
    writes,
  };
}

test('new offline sessions always default to Planets without storage or login', () => {
  assert.equal(loadInspectorTab(null),DEFAULT_INSPECTOR_TAB);
  assert.equal(loadInspectorTab(memoryStorage()),'planets');
});

test('all three tabs survive a fresh UI instance through a single local enum', () => {
  const store=memoryStorage();
  for(const tab of ['planets','houses','settings']) {
    assert.equal(saveInspectorTab(store,tab),true);
    assert.equal(store.raw,tab);
    assert.equal(loadInspectorTab(store),tab);
  }
  assert.deepEqual(store.writes,['planets','houses','settings']);
});

test('malformed, obsolete and injection-like values fail closed to Planets', () => {
  for(const bad of ['archive','birth', '__proto__', '<script>alert(1)</script>', '{"tab":"houses"}', '', 'a'.repeat(4096), null]) {
    assert.equal(loadInspectorTab(memoryStorage(bad)),'planets',String(bad));
    assert.equal(isInspectorTab(bad),false);
  }
});

test('only exact allowlisted tab names can be written', () => {
  const store=memoryStorage();
  for(const bad of ['archive', '__proto__', '', 42, null, {}, ['houses'], 'HOUSES']) {
    assert.equal(saveInspectorTab(store,bad),false,String(bad));
  }
  assert.deepEqual(store.writes,[]);
});

test('inaccessible storage and throwing getters never prevent UI interaction', () => {
  const blocked={getItem(){throw Error('private');},setItem(){throw Error('quota');}};
  assert.equal(loadInspectorTab(blocked),'planets');
  assert.equal(saveInspectorTab(blocked,'houses'),false);
  const inaccessible={get getItem(){throw Error('private');},get setItem(){throw Error('private');}};
  assert.equal(loadInspectorTab(inaccessible),'planets');
  assert.equal(saveInspectorTab(inaccessible,'settings'),false);
});

test('persisted data is a plain tab identifier, with no location or birth payload', () => {
  const store=memoryStorage();
  const dangerous={name:'private birth',selectedCity:'secret'};
  assert.equal(saveInspectorTab(store,dangerous),false);
  assert.equal(saveInspectorTab(store,'settings'),true);
  assert.equal(store.raw,'settings');
  assert.equal(store.raw.includes('secret'),false);
});
