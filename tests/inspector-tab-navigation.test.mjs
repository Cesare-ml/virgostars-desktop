import test from 'node:test';
import assert from 'node:assert/strict';
import {nextInspectorTab} from '../src/app/inspector-tab-navigation.ts';

test('right arrow cycles through inspector tabs and wraps around', () => {
  assert.equal(nextInspectorTab('planets', 'ArrowRight'), 'houses');
  assert.equal(nextInspectorTab('houses', 'ArrowRight'), 'settings');
  assert.equal(nextInspectorTab('settings', 'ArrowRight'), 'planets');
});

test('left arrow cycles backwards and wraps around', () => {
  assert.equal(nextInspectorTab('planets', 'ArrowLeft'), 'settings');
  assert.equal(nextInspectorTab('settings', 'ArrowLeft'), 'houses');
  assert.equal(nextInspectorTab('houses', 'ArrowLeft'), 'planets');
});

test('Home and End jump to first and last tab from every position', () => {
  for (const tab of ['planets', 'houses', 'settings']) {
    assert.equal(nextInspectorTab(tab, 'Home'), 'planets');
    assert.equal(nextInspectorTab(tab, 'End'), 'settings');
  }
});

test('unrelated key presses do not change active tab', () => {
  for (const key of ['Tab', 'Enter', ' ', 'Escape', 'ArrowUp', 'ArrowDown', 'a', '']) {
    assert.equal(nextInspectorTab('houses', key), null, key);
  }
});

test('invalid tab state never selects another tab', () => {
  assert.equal(nextInspectorTab('missing', 'ArrowRight'), null);
});
