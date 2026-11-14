import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {newOfflineCityPickerDomIds} from '../src/app/offline-city-picker-dom-ids.ts';

test('two simultaneous city pickers have disjoint input, listbox and option ids', () => {
  const first = newOfflineCityPickerDomIds();
  const second = newOfflineCityPickerDomIds();
  const one = [first.inputId, first.listId, ...Array.from({length: 12}, (_, i) => first.optionId(i))];
  const two = [second.inputId, second.listId, ...Array.from({length: 12}, (_, i) => second.optionId(i))];
  assert.equal(new Set([...one, ...two]).size, 28);
  for (const id of [...one, ...two]) assert.match(id, /^vs-offline-city-\d+-(?:input|list|option-\d+)$/);
});

test('ids remain stable during one picker lifetime, but change after remount', () => {
  const first = newOfflineCityPickerDomIds();
  const inputId = first.inputId;
  const resultId = first.listId;
  const optionId = first.optionId(0);
  newOfflineCityPickerDomIds();
  assert.equal(first.inputId, inputId);
  assert.equal(first.listId, resultId);
  assert.equal(first.optionId(0), optionId);
  const remounted = newOfflineCityPickerDomIds();
  assert.notEqual(remounted.inputId, inputId);
  assert.notEqual(remounted.optionId(0), optionId);
});

test('input and results use unique instance ids in label and ARIA bindings', () => {
  const component = readFileSync(new URL('../src/app/offline-city-picker.component.ts', import.meta.url), 'utf8');
  const template = readFileSync(new URL('../src/app/offline-city-picker.component.html', import.meta.url), 'utf8');
  assert.match(component, /readonly domIds = newOfflineCityPickerDomIds\(\)/);
  assert.match(template, /<label[^>]+\[attr\.for\]="domIds\.inputId"/);
  assert.match(template, /<input[\s\S]+?\[attr\.id\]="domIds\.inputId"/);
  assert.match(template, /\[attr\.aria-controls\]="state\.results\.length \? domIds\.listId : null"/);
  assert.match(template, /\[attr\.aria-activedescendant\]="state\.activeIndex >= 0 \? domIds\.optionId\(state\.activeIndex\) : null"/);
  assert.match(template, /role="listbox"[^>]*\*ngIf="state\.results\.length"/);
  assert.match(template, /\[attr\.id\]="domIds\.listId"/);
  assert.match(template, /\[attr\.id\]="domIds\.optionId\(i\)"/);
  assert.doesNotMatch(template, /\b(?:id|for)="offline-city-(?:query|options|option-)/);
});

test('aria-controls does not reference the removed listbox while collapsed', () => {
  const template = readFileSync(new URL('../src/app/offline-city-picker.component.html', import.meta.url), 'utf8');
  assert.match(template, /\[attr\.aria-expanded\]="state\.results\.length > 0"/);
  assert.match(template, /\[attr\.aria-controls\]="state\.results\.length \? domIds\.listId : null"/);
  assert.match(template, /\*ngIf="state\.results\.length"/);
});
