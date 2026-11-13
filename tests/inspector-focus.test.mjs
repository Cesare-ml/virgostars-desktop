import test from 'node:test';
import assert from 'node:assert/strict';
import {preserveInspectorFocusOnClose} from '../src/app/inspector-focus.ts';

const active = {kind: 'active tab'};

function fixture(isInside = true) {
  const focusCalls = [];
  const panel = {contains(element) {
    assert.equal(element, active);
    return isInside;
  }};
  const toggle = {focus(options) {focusCalls.push(options);}};
  return {panel, toggle, focusCalls};
}

test('closing a panel containing keyboard focus restores focus to its durable toggle', () => {
  const f = fixture();
  preserveInspectorFocusOnClose(f.panel, active, f.toggle);
  assert.deepEqual(f.focusCalls,[{preventScroll:true}]);
});

test('closing a panel with focus outside does not steal keyboard focus', () => {
  const f = fixture(false);
  preserveInspectorFocusOnClose(f.panel, active, f.toggle);
  assert.deepEqual(f.focusCalls,[]);
});

test('opening a panel or trying to close an absent panel never changes focus', () => {
  const f = fixture();
  preserveInspectorFocusOnClose(undefined, active, f.toggle);
  preserveInspectorFocusOnClose(null, active, f.toggle);
  assert.deepEqual(f.focusCalls,[]);
});

test('a missing toggle does not throw even with focus inside the panel', () => {
  const f = fixture();
  assert.doesNotThrow(() => preserveInspectorFocusOnClose(f.panel, active, undefined));
});

test('a throwing focus() never interrupts inspector closure', () => {
  const f = fixture();
  const toggle = {focus() {throw new Error('blocked WebView focus');}};
  assert.doesNotThrow(() => preserveInspectorFocusOnClose(f.panel, active, toggle));
});

test('a throwing contains() never blocks inspector closure', () => {
  const panel = {contains() {throw new Error('stale DOM view');}};
  const f = fixture();
  assert.doesNotThrow(() => preserveInspectorFocusOnClose(panel, active, f.toggle));
  assert.deepEqual(f.focusCalls,[]);
});
