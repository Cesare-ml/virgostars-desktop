import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cityPickerKeyAction} from '../src/app/offline-city-keyboard.ts';

test('arrow keys move only while suggestions exist; Enter requires an active option', () => {
  assert.equal(cityPickerKeyAction('ArrowDown', 3, -1), 'next');
  assert.equal(cityPickerKeyAction('ArrowUp', 3, 0), 'previous');
  assert.equal(cityPickerKeyAction('Enter', 3, -1), 'none');
  assert.equal(cityPickerKeyAction('Enter', 3, 2), 'choose');
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter']) {
    assert.equal(cityPickerKeyAction(key, 0, -1), 'none');
  }
});

test('Tab exits open suggestions without trapping focus; Escape cancels pending searches', () => {
  assert.equal(cityPickerKeyAction('Tab', 3, 1), 'dismiss');
  assert.equal(cityPickerKeyAction('Tab', 0, -1), 'none');
  assert.equal(cityPickerKeyAction('Escape', 3, 1), 'dismiss');
  assert.equal(cityPickerKeyAction('Escape', 0, -1), 'dismiss');
  for (const key of ['Home', 'End', 'PageDown', 'a', 'Shift']) {
    assert.equal(cityPickerKeyAction(key, 2, 0), 'none');
  }
});

test('invalid counts and indices fail closed without choosing a stale option', () => {
  for (const [count, index] of [[-1, -1], [NaN, 0], [Infinity, 0], [2.5, 0], [2, -2], [2, 2], [0, 0]]) {
    for (const key of ['Enter', 'ArrowDown', 'Tab']) {
      assert.equal(cityPickerKeyAction(key, count, index), 'none');
    }
  }
});

test('Angular combobox stays a single tab stop; options remain clickable and screen-reader-described', () => {
  const html = readFileSync(new URL('../src/app/offline-city-picker.component.html', import.meta.url), 'utf8');
  const component = readFileSync(new URL('../src/app/offline-city-picker.component.ts', import.meta.url), 'utf8');
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-haspopup="listbox"/);
  assert.match(html, /aria-describedby="offline-city-query-status"/);
  assert.match(html, /id="offline-city-query-status"/);
  assert.match(html, /class="city-option" role="option" tabindex="-1"/);
  assert.match(html, /\(click\)="choose\(i\)"/);
  assert.match(component, /cityPickerKeyAction\(event\.key, this\.state\.results\.length, this\.state\.activeIndex\)/);
  assert.match(component, /case 'dismiss':[\s\S]*?if\s*\(event\.key === 'Escape'/);
  assert.match(component, /this\.state\.dismiss\(\)/);
});
